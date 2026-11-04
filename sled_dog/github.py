"""Host-bound GitHub REST operations. No provider URLs receive credentials."""
import os
import re
import ssl
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx

from .config import Failure


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def component(value):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', value) or value in ('.', '..'):
        raise Failure('Invalid owner or repository name.', 2)
    return value


class GitHub:
    def __init__(self, base, token):
        ca = os.environ.get('SLED_DOG_CA_BUNDLE')
        try:
            verify = ssl.create_default_context(cafile=ca) if ca else True
            self.client = httpx.Client(headers={'Accept': 'application/vnd.github+json',
                'Authorization': f'Bearer {token}'}, timeout=20, verify=verify, follow_redirects=False)
        except (OSError, ValueError):
            raise Failure('Cannot initialize TLS. Check SLED_DOG_CA_BUNDLE.') from None
        self.base = base

    def close(self):
        self.client.close()

    def get(self, path, params=None):
        if not path.startswith('/') or '://' in path or '..' in path.split('/'):
            raise Failure('Refused an unsafe API path.')
        try:
            response = self.client.get(self.base + path, params=params)
        except httpx.HTTPError:
            raise Failure('Cannot reach GitHub. Check host, VPN, network, and certificate trust.') from None
        status = response.status_code
        if status == 401:
            raise Failure('GitHub rejected credentials. Run sled-dog auth login for this host.', 3)
        if status in (403, 429):
            if status == 429 or response.headers.get('x-ratelimit-remaining') == '0' or response.headers.get('retry-after'):
                raise Failure('GitHub rate limit reached. Wait before retrying.')
            raise Failure('GitHub denied access. Check token permissions and organization SSO authorization.')
        if status == 404:
            raise Failure('Resource unavailable. Check host, repository, account, and token permissions.')
        if 300 <= status < 400:
            raise Failure('GitHub redirected the request. Update the configured API base; credentials were not forwarded.')
        if status >= 400:
            raise Failure(f'GitHub request failed (HTTP {status}). Check arguments and host compatibility.')
        try:
            return response.json()
        except ValueError:
            raise Failure('GitHub returned an invalid JSON response.') from None

    def pages(self, path, key=None, params=None):
        result = []
        for page in range(1, 101):
            payload = self.get(path, dict(params or {}, per_page=100, page=page))
            rows = payload.get(key, []) if key else payload
            if not isinstance(rows, list):
                raise Failure('Unexpected GitHub response format.')
            result.extend(rows)
            if len(rows) < 100:
                return result
        raise Failure('Pagination safety limit reached. Narrow the request.', 4)

    def identity(self):
        user = self.get('/user')
        login = user.get('login')
        if not isinstance(login, str) or not re.fullmatch(r'[A-Za-z0-9-]+', login):
            raise Failure('GitHub did not return a valid account identity.', 3)
        return login

    def search(self, login, args):
        query = ['is:pr']
        if args.state != 'all':
            query.append('is:' + args.state)
        if args.mine:
            query.append('author:' + login)
        if args.review_requested:
            query.append('review-requested:' + login)
        if args.org:
            query.append('org:' + component(args.org))
        if args.repo:
            owner, repo = repository(args.repo)
            query.append(f'repo:{owner}/{repo}')
        queries = [' '.join(query)]
        warnings = []
        if args.review_requested:
            try:
                teams = self.pages('/user/teams')
                for team in teams:
                    org = component(team['organization']['login'])
                    slug = component(team['slug'])
                    queries.append(' '.join(x for x in query if not x.startswith('review-requested:')) + f' team-review-requested:{org}/{slug}')
            except Failure:
                warnings.append('Team review requests unavailable. Check team visibility permissions.')
        rows = {}
        incomplete = bool(warnings)
        ceiling = False
        truncated = False
        for search_query in queries:
            count = 0
            for page in range(1, 11):
                payload = self.get('/search/issues', {'q':search_query, 'sort':'updated', 'order':'desc', 'per_page':100, 'page':page})
                batch = payload.get('items', [])
                total = payload.get('total_count', 0)
                count += len(batch)
                incomplete |= bool(payload.get('incomplete_results'))
                ceiling |= total > 1000
                for row in batch:
                    rows[row['html_url']] = row
                if count >= args.limit or len(batch) < 100:
                    truncated |= total > min(count, args.limit)
                    break
        ordered = sorted(rows.values(), key=lambda row: (row.get('updated_at', ''), row.get('html_url', '')), reverse=True)
        return [self.summary(row) for row in ordered[:args.limit]], {
            'truncated': truncated or len(ordered) > args.limit,
            'complete': not incomplete, 'provider_ceiling':ceiling,
            'limit':args.limit, 'warnings':warnings}

    @staticmethod
    def summary(row):
        # Do not follow repository_url or pull_request.url from search responses.
        return {key: row.get(key) for key in ('number', 'title', 'html_url', 'state', 'draft', 'updated_at')} | {
            'repository': '/'.join(str(row.get('html_url', '')).split('/')[3:5]),
            'author': (row.get('user') or {}).get('login'),
            'labels': [x.get('name') for x in row.get('labels', [])],
            'label_colors': {x.get('name'): x.get('color') for x in row.get('labels', []) if x.get('name')}}

    def detail(self, owner, repo, number):
        path = f'/repos/{owner}/{repo}/pulls/{number}'
        row = self.get(path)
        data = self.summary(row)
        data.update({'body': row.get('body'), 'merged': row.get('merged'), 'mergeable': row.get('mergeable'),
            'head_sha': row.get('head', {}).get('sha'), 'head_branch': row.get('head', {}).get('ref'),
            'base_branch': row.get('base', {}).get('ref'), 'additions': row.get('additions'), 'deletions': row.get('deletions')})
        warnings = []
        try:
            reviews = self.pages(path + '/reviews')
            latest = {}
            for review in reviews:
                user = (review.get('user') or {}).get('login')
                if user and review.get('state') != 'PENDING':
                    latest[user] = {'reviewer': user, 'state': review.get('state'), 'submitted_at': review.get('submitted_at')}
            data['reviews'] = list(latest.values())
        except Failure:
            data['reviews'] = None
            warnings.append('Review summary unavailable.')
        return data, warnings

    def builds(self, pull_requests):
        """Enrich only displayed PRs, with bounded concurrency and isolated errors."""
        def load(row):
            try:
                owner, repo = repository(row['repository'])
                data, errors = self.checks(owner, repo, int(row['number']))
                if data['stale']:
                    errors.append({'message':'PR head changed. Rerun to refresh build status.'})
                summary = {'state':data['state'], 'head_sha':data['head_sha'],
                           'counts':dict(Counter(check['state'] for check in data['checks'])),
                           'total':len(data['checks']), 'fetched_at':now(), 'errors':errors}
            except Failure as exc:
                errors = [{'message':str(exc)}]
                summary = {'state':'unavailable', 'head_sha':None, 'counts':{},
                           'total':None, 'fetched_at':now(), 'errors':errors}
            return dict(row, build=summary)
        with ThreadPoolExecutor(max_workers=4) as executor:
            rows = list(executor.map(load, pull_requests))
        errors = [{'repository':row['repository'], 'number':row['number'],
                   'message':'Build status incomplete or unavailable. See build.errors.'}
                  for row in rows if row['build']['errors']]
        return rows, errors

    def checks(self, owner, repo, number):
        pr_path = f'/repos/{owner}/{repo}/pulls/{number}'
        sha = self.get(pr_path).get('head', {}).get('sha')
        if not sha or not re.fullmatch('[a-fA-F0-9]{40,64}', sha):
            raise Failure('GitHub did not return a valid PR head SHA.')
        root = f'/repos/{owner}/{repo}/commits/{sha}'
        rows, errors = [], []
        for source, path, key in [('check', root + '/check-runs', 'check_runs'), ('status', root + '/statuses', None)]:
            try:
                raw = self.pages(path, key, {'filter':'latest'} if source == 'check' else None)
                latest = {}
                for item in raw:
                    identity = ((item.get('app') or {}).get('id'), (item.get('check_suite') or {}).get('id'), item.get('name')) if source == 'check' else item.get('context')
                    if identity not in latest or item.get('id', 0) > latest[identity].get('id', 0):
                        latest[identity] = item
                for item in latest.values():
                    state = item.get('conclusion') if source == 'check' and item.get('status') == 'completed' else item.get('status') if source == 'check' else item.get('state')
                    normalized = {'queued':'pending', 'in_progress':'pending', 'waiting':'pending', 'requested':'pending', 'error':'failure'}.get(state, state)
                    if normalized not in {'success','failure','pending','cancelled','skipped','neutral','action_required','timed_out','stale'}:
                        normalized = 'unknown'
                    rows.append({'id':item.get('id'), 'source':source, 'name':item.get('name') or item.get('context'),
                        'state':normalized, 'raw_state':item.get('status') or item.get('state'), 'conclusion':item.get('conclusion'),
                        'url':item.get('html_url') or item.get('target_url'), 'started_at':item.get('started_at') or item.get('created_at'), 'completed_at':item.get('completed_at')})
            except Failure as exc:
                errors.append({'source':source, 'message':str(exc)})
        rows.sort(key=lambda row: (row['name'] or '', row['source'], row['id'] or 0))
        stale = self.get(pr_path).get('head', {}).get('sha') != sha
        states = {row['state'] for row in rows}
        aggregate = 'unavailable' if errors else 'none' if not rows else 'failure' if states & {'failure','timed_out','action_required'} else 'pending' if 'pending' in states else 'success' if states == {'success'} else 'mixed'
        return {'head_sha':sha, 'stale':stale, 'state': 'stale' if stale else aggregate, 'checks':rows}, errors


def repository(value):
    parts = value.split('/')
    if len(parts) != 2:
        raise Failure('Repository must be OWNER/REPO.', 2)
    return tuple(component(x) for x in parts)
