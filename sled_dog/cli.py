"""Finite commands with one machine-readable output contract."""
import argparse
import getpass
import json
import os
import re
import sys
import warnings
from datetime import datetime, timezone
from urllib.parse import urlsplit

from . import __version__
from .config import Config, Failure, Secrets, api_base, host_name, component, now, repository


def safe(value):
    # Remove CSI, OSC, and other control sequences from untrusted terminal text.
    value = re.sub(r'\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)', '', str(value))
    value = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', value)
    return ''.join(c for c in value if c in '\n\t' or (ord(c) >= 32 and not 127 <= ord(c) <= 159))


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Failure(message, 2)


def parser():
    common = Parser(add_help=False)
    common.add_argument('--host')
    common.add_argument('--account')
    common.add_argument('--json', action='store_true')
    common.add_argument('--color', choices=['auto', 'always', 'never'], default='auto')
    root = Parser(prog='sled-dog', description='Your pull requests and checks. Print, finish, return to your shell.')
    root.add_argument('--version', action='version', version=f'Sled Dog {__version__}')
    subs = root.add_subparsers(dest='command')
    subs.add_parser('doctor', parents=[common], help='Check installation without network or secrets')
    auth = subs.add_parser('auth').add_subparsers(dest='action', required=True)
    for name in ('login', 'status', 'switch', 'logout', 'migrate'):
        p = auth.add_parser(name, parents=[common])
        if name == 'login':
            p.add_argument('--api-base')
            p.add_argument('--with-token', action='store_true', help='Read token from stdin')
    pr = subs.add_parser('pr').add_subparsers(dest='action', required=True)
    p = pr.add_parser('list', parents=[common])
    mode = p.add_mutually_exclusive_group()
    mode.add_argument('--mine', action='store_true')
    mode.add_argument('--review-requested', action='store_true')
    p.add_argument('--org')
    p.add_argument('--repo')
    p.add_argument('--limit', type=int, default=30)
    p.add_argument('--cards', action='store_true', help='Use full cards for the review-request queue')
    p.add_argument('--no-checks', action='store_true', help='Skip build lookups for a faster list')
    p.add_argument('--state', choices=['open','closed','all'], default='open')
    for name in ('view','checks'):
        p = pr.add_parser(name, parents=[common])
        p.add_argument('reference', help='OWNER/REPO#NUMBER or HTTPS PR URL')
    return root


def reference(value, explicit_host):
    urlhost = None
    if value.startswith('https://'):
        parsed = urlsplit(value)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise Failure('PR URL must not include credentials, query, or fragment.', 2)
        urlhost = host_name(parsed.netloc)
        match = re.fullmatch(r'/([^/]+)/([^/]+)/pull/([1-9][0-9]*)/?', parsed.path)
    else:
        match = re.fullmatch(r'([^/]+)/([^/#]+)#([1-9][0-9]*)', value)
    if not match:
        raise Failure('Use OWNER/REPO#NUMBER or an HTTPS pull request URL.', 2)
    if explicit_host and urlhost and host_name(explicit_host) != urlhost:
        raise Failure('PR URL conflicts with --host.', 2)
    owner, repo, number = match.groups()
    return urlhost, component(owner), component(repo), int(number)


def envelope(data=None, meta=None, errors=None):
    return {'schema_version':1, 'data':data, 'meta':meta or {}, 'errors':errors or []}


def run(args, config, secrets_factory=Secrets, github_factory=None):
    if args.command == 'doctor':
        import ssl
        import httpx
        import rich
        ssl.create_default_context()
        try:
            secrets_factory()
            credential_store = 'available'
        except Failure:
            credential_store = 'unavailable; use SLED_DOG_TOKEN with --host on headless systems'
        return envelope({'version':__version__, 'platform':sys.platform, 'standalone':bool(getattr(sys, 'frozen', False)),
                         'credential_store':credential_store, 'eastern_timezone':eastern_time('2026-07-15T20:30:00Z')}, {'complete':True}), 0
    selected = None
    if args.command == 'pr' and args.action != 'list':
        selected = reference(args.reference, args.host)
    host = host_name((selected[0] if selected else None) or args.host or config.data.get('default_host', 'github.com'))
    entry = config.data['hosts'].get(host, {})
    account = args.account or (None if args.command == 'auth' and args.action in ('login', 'migrate') else entry.get('active'))
    meta = {'host':host, 'account':account, 'fetched_at':now(), 'complete':True}
    if args.command == 'auth' and args.action == 'status':
        rows = []
        for h, e in sorted(config.data['hosts'].items()):
            if args.host and h != host:
                continue
            for login in e['accounts']:
                if args.account and login.lower() != args.account.lower():
                    continue
                rows.append({'host':h, 'account':login, 'active':login == e.get('active'), 'credential_source':'native OS credential store', 'api_base':e['api_base']})
        return envelope(rows, meta), 0
    if args.command == 'auth' and args.action in ('switch','logout'):
        if not args.host or not args.account:
            raise Failure('Specify --host and --account.', 2)
        matches = [x for x in entry.get('accounts', []) if x.lower() == account.lower()]
        if not matches:
            raise Failure('Account not configured. Run sled-dog auth login --host HOST.', 3)
        account = matches[0]
        if args.action == 'switch':
            entry['active'] = account
            config.data['default_host'] = host
        else:
            secrets_factory().delete(host, account)
            entry['accounts'].remove(account)
            if entry.get('active') == account:
                entry['active'] = next(iter(entry['accounts']), None)
        config.save()
        return envelope({'action':args.action, 'account':account}, meta), 0
    if args.command == 'pr' and args.action == 'list':
        if not (args.mine or args.review_requested or args.org):
            raise Failure('Choose --mine, --review-requested, or --org ORG.', 2)
        if not 1 <= args.limit <= 1000:
            raise Failure('--limit must be between 1 and 1000.', 2)
        if args.repo:
            repository(args.repo)
        if args.org:
            component(args.org)
    login = args.command == 'auth' and args.action in ('login', 'migrate')
    if login and args.action == 'migrate':
        if not args.host:
            raise Failure('Migration requires --host to confirm the legacy credential destination.', 2)
        try:
            legacy = json.loads((config.path.parent / 'config.json').read_text())
            base = api_base(host, legacy['github_api_url'])
        except (OSError, ValueError, KeyError, TypeError):
            raise Failure('Cannot read legacy config.json. No settings were changed.') from None
        expected = entry.get('api_base') or api_base(host)
        if base != expected:
            raise Failure('Legacy API URL differs from this host API base. Configure the host explicitly first.', 2)
        token = secrets_factory().legacy()
    elif login:
        if args.json and not args.with_token:
            raise Failure('JSON login requires --with-token and token input on stdin.', 2)
        if args.with_token:
            if sys.stdin.isatty():
                raise Failure('Pipe a token to --with-token; use hidden login for a terminal.', 2)
            token = sys.stdin.read().strip()
        elif sys.stdin.isatty():
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter('error', getpass.GetPassWarning)
                    token = getpass.getpass('GitHub token (hidden): ').strip()
            except getpass.GetPassWarning:
                raise Failure('Hidden token input unavailable. Use --with-token and secure stdin.', 3) from None
        else:
            raise Failure('Use --with-token with stdin for noninteractive login.', 2)
        base = api_base(host, args.api_base or entry.get('api_base'))
    else:
        token = os.environ.get('SLED_DOG_TOKEN')
        if token is not None:
            if not args.host and not (selected and selected[0]):
                raise Failure('SLED_DOG_TOKEN requires an explicit --host or PR URL host.', 2)
        else:
            if not account:
                raise Failure('No account selected. Run sled-dog auth login --host HOST.', 3)
            token = secrets_factory().get(host, account)
        base = api_base(host, entry.get('api_base'))
    if not token:
        raise Failure('No token available. Run sled-dog auth login --host HOST.', 3)
    if github_factory is None:
        from .github import GitHub
        github_factory = GitHub
    github = github_factory(base, token)
    try:
        identity = github.identity()
        if account and account.lower() != identity.lower():
            raise Failure('Token identity differs from selected account. Select the matching account.', 3)
        meta['account'] = identity
        if login:
            secrets_factory().put(host, identity, token)
            entry = config.data['hosts'].setdefault(host, {'accounts':[]})
            entry['api_base'] = base
            if identity not in entry['accounts']:
                entry['accounts'].append(identity)
            entry['active'] = identity
            config.data['default_host'] = host
            config.save()
            return envelope({'action':args.action, 'account':identity}, meta), 0
        if args.action == 'list':
            meta['view'] = 'reviews' if args.review_requested and not args.cards else 'cards'
            rows, extra = github.search(identity, args)
            meta.update(extra)
            errors = [] if meta['complete'] else [{'message':'GitHub search returned incomplete results. Narrow the query.'}]
            rows, enrichment_errors = github.enrich(rows, include_checks=not args.no_checks)
            errors.extend(enrichment_errors)
            meta['complete'] = not errors
            return envelope(rows, meta, errors), 0 if meta['complete'] else 4
        _, owner, repo, number = selected
        meta.update({'repository':f'{owner}/{repo}', 'number':number})
        if args.action == 'view':
            data, detail_warnings = github.detail(owner, repo, number)
            meta['warnings'] = detail_warnings
            rows, build_errors = github.builds([data])
            errors = [{'message':warning} for warning in detail_warnings] + build_errors
            meta['complete'] = not errors
            return envelope(rows[0], meta, errors), 4 if errors else 0
        data, errors = github.checks(owner, repo, number)
        if data['stale']:
            errors.append({'message':'PR head changed during retrieval. Rerun checks.'})
        meta['complete'] = not errors
        return envelope(data, meta, errors), 4 if errors else 0
    finally:
        github.close()


def pr_age(created_at, at=None):
    try:
        created = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
        if created.tzinfo is None:
            return 'unknown'
        seconds = max(0, int(((at or datetime.now(timezone.utc)) - created).total_seconds()))
    except (TypeError, ValueError, AttributeError):
        return 'unknown'
    if seconds < 60:
        return '<1m'
    if seconds < 3600:
        return f'{seconds // 60}m'
    if seconds < 86400:
        return f'{seconds // 3600}h'
    return f'{seconds // 86400}d'


def eastern_time(value):
    from zoneinfo import ZoneInfo
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            return 'unknown'
        return stamp.astimezone(ZoneInfo('America/New_York')).strftime('%b %d %H:%M %Z')
    except (AttributeError, TypeError, ValueError):
        return 'unknown'


def review_queue(rows, console):
    """Compact review rows grouped by repository, with a narrow-terminal fallback."""
    from rich.table import Table
    from rich.text import Text
    groups = {}
    for row in rows:
        groups.setdefault(row.get('repository') or 'Unknown repository', []).append(row)
    console.print('Review requests · Updated times: Eastern (EST/EDT)', style='dim')
    for repo, items in groups.items():
        console.print(safe(repo), style='bold cyan')
        table = Table(box=None, padding=(0, 1), expand=True, show_edge=False)
        narrow = console.width < 100
        table.add_column('Pull request', ratio=3, min_width=18)
        if not narrow:
            table.add_column('Build', min_width=7)
            table.add_column('Reviews / comments', ratio=2, min_width=15)
            table.add_column('Changes', min_width=8)
            table.add_column('Age / updated (Eastern)', min_width=17)
        for row in items:
            title = Text(f"#{row['number']} ", style='bold magenta')
            title.append(safe(row.get('title') or 'Untitled pull request'), style='bold')
            labels = row.get('labels') or []
            title.append('\n' + safe(' · '.join(labels)) if labels else '\nNo labels', style='magenta' if labels else 'dim')
            build = (row.get('build') or {}).get('state', 'not fetched')
            style = {'success':'green','failure':'red','pending':'yellow','stale':'yellow'}.get(build, 'dim')
            approvals = row.get('approval_count')
            comments = row.get('comment_count')
            review = Text(f"{approvals if approvals is not None else '?'} approvals · {comments if comments is not None else '?'} comments")
            reviewers = row.get('reviews')
            review.append('\n' + safe(', '.join(r['reviewer'] + ' (' + r['state'].lower().replace('_', ' ') + ')' for r in reviewers)) if reviewers else '\n' + ('Reviews unavailable' if reviewers is None else 'No reviews yet'), style='dim')
            changes = Text('+' + str(row['additions'] if row.get('additions') is not None else '?'), style='green')
            changes.append(' / -' + str(row['deletions'] if row.get('deletions') is not None else '?'), style='red')
            age = 'Age ' + pr_age(row.get('created_at'))
            updated = eastern_time(row.get('updated_at'))
            if narrow:
                title.append('\n' + age + ' · Build ' + build, style=style)
                title.append(' · ')
                title.append_text(changes)
                title.append('\n')
                title.append_text(review)
                title.append('\nUpdated ' + updated + ' (Eastern)', style='dim')
                table.add_row(title)
            else:
                table.add_row(title, Text(build.upper(), style=style), review, changes, Text(age+'\n'+updated, style='dim'))
        console.print(table)
        console.print()
    console.print('Use pr view OWNER/REPO#NUMBER for details and URL, or --cards for full cards.', style='dim')


def pr_card(row):
    """Build literal, wrapping terminal cards; never interpret provider markup."""
    from rich.console import Group
    from rich.panel import Panel
    from rich.text import Text

    state = 'merged' if row.get('merged') else 'draft' if row.get('draft') else row.get('state') or 'unknown'
    state_style = {'open':'bold black on green', 'closed':'bold white on red',
                   'merged':'bold white on magenta', 'draft':'bold black on yellow'}.get(state, 'bold white on bright_black')
    border = {'open':'green', 'closed':'red', 'merged':'magenta', 'draft':'yellow'}.get(state, 'cyan')
    status = Text()
    status.append(' ' + state.upper() + ' ', style=state_style)
    status.append('  @' + safe(row.get('author') or 'unknown'), style='cyan')
    status.append('  Age ' + pr_age(row.get('created_at')), style='bold yellow')
    if row.get('updated_at'):
        status.append('  updated ' + eastern_time(row['updated_at']) + ' (Eastern)', style='dim')
    parts = [Text(safe(row.get('html_url') or ''), style='cyan'), Text(''), status]
    if 'additions' in row or 'approval_count' in row:
        def count(value):
            return '?' if value is None else str(value)
        stats = Text('+' + count(row.get('additions')), style='bold green')
        stats.append('  -' + count(row.get('deletions')), style='bold red')
        stats.append('   ' + count(row.get('approval_count')) + (' approval' if row.get('approval_count') == 1 else ' approvals'), style='bold green')
        stats.append('   ' + count(row.get('comment_count')) + (' comment' if row.get('comment_count') == 1 else ' comments'), style='cyan')
        parts.extend([Text(''), stats])
        reviews = row.get('reviews')
        reviewers = Text('Reviewed by  ', style='dim')
        if reviews is None:
            reviewers.append('unavailable', style='yellow')
        elif not reviews:
            reviewers.append('no reviews yet', style='dim')
        else:
            for index, review in enumerate(reviews):
                if index:
                    reviewers.append(' · ')
                style = {'APPROVED':'green', 'CHANGES_REQUESTED':'red', 'DISMISSED':'yellow'}.get(review['state'], 'cyan')
                reviewers.append(safe(review['reviewer']) + ' (' + safe(review['state'].lower().replace('_', ' ')) + ')', style=style)
        parts.append(reviewers)
    build = row.get('build')
    if build:
        build_state = build['state']
        badge_style = {'success':'bold black on green', 'failure':'bold white on red',
                       'pending':'bold black on yellow', 'stale':'bold black on yellow',
                       'unavailable':'bold white on bright_black', 'none':'dim'}.get(build_state, 'bold cyan')
        captions = {'success':'PASSING', 'failure':'FAILING', 'pending':'RUNNING / QUEUED',
                    'none':'NO CHECKS', 'unavailable':'UNAVAILABLE', 'stale':'STALE — RERUN', 'mixed':'MIXED'}
        line = Text('Build  ', style='bold')
        line.append(' ' + captions.get(build_state, build_state.upper()) + ' ', style=badge_style)
        counts = build.get('counts') or {}
        if counts:
            line.append('  ' + ' · '.join(f'{count} {name}' for name, count in sorted(counts.items())), style='dim')
        parts.extend([Text(''), line])
    labels = Text()
    for label in row.get('labels') or []:
        color = (row.get('label_colors') or {}).get(label)
        if not isinstance(color, str) or not re.fullmatch('[0-9a-fA-F]{6}', color):
            color = '6d28d9'
        red, green, blue = (int(color[i:i+2], 16) for i in (0,2,4))
        foreground = 'black' if 0.2126*red + 0.7152*green + 0.0722*blue > 155 else 'white'
        if labels:
            labels.append('  ')
        labels.append(' ' + safe(label) + ' ', style=f'bold {foreground} on #{color}')
    parts.extend([Text(''), labels if labels else Text('No labels', style='dim')])
    if 'head_branch' in row:
        branches = Text(safe(row.get('head_branch') or '?'), style='cyan')
        branches.append(' → ', style='dim')
        branches.append(safe(row.get('base_branch') or '?'), style='magenta')
        changes = Text('Head ' + safe(row.get('head_sha') or 'unknown'), style='dim')
        parts.extend([Text(''), branches, changes])
    heading = Text(safe(f"#{row['number']} {row.get('title') or 'Untitled pull request'}"), style='bold magenta')
    return Panel(Group(*parts), title=heading, title_align='left', border_style=border, padding=(0,2))


def render(result, color='auto'):
    from rich.console import Console
    console = Console(highlight=False, markup=False, no_color=False if color == 'always' else None, force_terminal=True if color == 'always' else False if color == 'never' or os.getenv('NO_COLOR') is not None else None)
    meta, data = result['meta'], result['data']
    console.rule('Sled Dog', style='magenta', align='left')
    if meta.get('host'):
        console.print(safe(f"{meta['host']} / {meta.get('account') or 'no active account'}"), style='dim')
    console.print()
    if isinstance(data, list):
        if not data:
            console.print('No results.')
        if meta.get('view') == 'reviews' and data:
            review_queue(data, console)
        for row in ([] if meta.get('view') == 'reviews' else data):
            if 'title' in row:
                console.print(pr_card(row))
            else:
                console.print(safe(f"{row['host']} / {row['account']}"), style='bold')
                console.print(safe(f"  {'active' if row['active'] else 'saved'} · {row['credential_source']}"))
            console.print()
    elif isinstance(data, dict):
        if 'title' in data:
            console.print(pr_card(data))
            console.print()
            console.print('Description', style='bold magenta')
            console.print(safe(data.get('body') or 'No description.'))
            console.print()
            reviews = data.get('reviews')
            console.print('Reviews', style='bold')
            if reviews is None:
                console.print('Unavailable.', style='yellow')
            elif not reviews:
                console.print('No submitted reviews.', style='dim')
            else:
                for review in reviews:
                    console.print(safe(f"  {review['reviewer']} · {review['state']}"))
        elif 'checks' in data:
            state = data['state'].upper()
            style = 'green' if state == 'SUCCESS' else 'red' if state == 'FAILURE' else 'yellow'
            console.print(safe(f"{meta['repository']} #{meta['number']} · {state}"), style=style)
            console.print(safe('Head ' + data['head_sha']), style='dim')
            console.print()
            if not data['checks']:
                console.print('No visible checks.' if data['state'] == 'none' else 'Checks unavailable.')
            for check in data['checks']:
                style = 'green' if check['state'] == 'success' else 'red' if check['state'] == 'failure' else 'yellow'
                console.print(safe(f"  {check['state'].upper():14} {check['name']}"), style=style)
                console.print(safe(f"    {check['source']} · {check.get('completed_at') or check.get('started_at') or 'time unknown'}"), style='dim')
                if check['url']:
                    console.print(safe('    ' + check['url']), style='dim')
        elif 'version' in data:
            for key, value in data.items():
                console.print(safe(f'{key.replace("_", " ")}: {value}'))
        elif 'action' in data:
            messages = {'login':'Connected', 'migrate':'Migrated connection for', 'switch':'Selected', 'logout':'Removed local credentials for'}
            console.print(safe(f"{messages[data['action']]} {data['account']} on {meta['host']}."), style='green')
    if isinstance(data, list) and data:
        console.print(f"{len(data)} result(s)", style='dim')
    if meta.get('truncated'):
        console.print('More results available; increase --limit or narrow the query.', style='yellow')
    for warning in meta.get('warnings', []):
        console.print(safe(warning), style='yellow')
    for error in result['errors']:
        console.print(safe(error['message']), style='red')


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    wants_json = '--json' in argv
    p = parser()
    try:
        if not argv:
            p.print_help()
            return 0
        args = p.parse_args(argv)
        if not args.command:
            p.print_help()
            return 0
        result, code = run(args, Config())
    except Failure as exc:
        result, code = envelope(errors=[{'message':str(exc), 'code':exc.code}]), exc.code
    except KeyboardInterrupt:
        result, code = envelope(errors=[{'message':'Interrupted.', 'code':130}]), 130
    except (OSError, ValueError, TypeError, KeyError, AttributeError, IndexError):
        result, code = envelope(errors=[{'message':'Cannot complete request. Check configuration and host response.', 'code':1}]), 1
    if wants_json:
        print(json.dumps(result, ensure_ascii=True))
    else:
        render(result, getattr(locals().get('args'), 'color', 'auto'))
    return code
