"""Client and commands for the Sled Dog platform (tickets), built for agents.

Every write supports --dry-run and an idempotency key so an agent can retry safely.
"""
import os
import re
import uuid
from urllib.parse import urlsplit

from .config import Failure, now

STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'test', 'done', 'canceled']
PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent']
LOCAL = ('localhost', '127.0.0.1', '::1')
STATUS_COLORS = {'backlog': 'bright_black', 'todo': 'blue', 'in_progress': 'yellow', 'in_review': 'magenta', 'test': 'cyan', 'done': 'green', 'canceled': 'red'}


def server_url(value):
    parsed = urlsplit(value)
    local = parsed.hostname in LOCAL
    if parsed.scheme not in ('https', 'http') or (parsed.scheme == 'http' and not local):
        raise Failure('Server URL must be HTTPS (plain HTTP is allowed only for localhost).', 2)
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or '%' in parsed.path:
        raise Failure('Server URL must not include credentials, query, or fragment.', 2)
    return value.rstrip('/')


def credential_host(url):
    return urlsplit(url).netloc.lower()


class Platform:
    def __init__(self, base, token, transport=None):
        import httpx
        self.base = base
        self.client = httpx.Client(headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'},
                                   timeout=20, follow_redirects=False, transport=transport)

    def close(self):
        self.client.close()

    def request(self, method, path, params=None, body=None, idempotency_key=None):
        import httpx
        headers = {'Idempotency-Key': idempotency_key} if idempotency_key else {}
        try:
            response = self.client.request(method, self.base + path, params=params, json=body, headers=headers)
        except httpx.HTTPError:
            raise Failure('Cannot reach the Sled Dog server. Check the URL and your network.') from None
        status = response.status_code
        if status in (401, 403):
            raise Failure('Server rejected the token or its scope. Run sled-dog server login.', 3)
        if status == 404:
            raise Failure('Not found on the Sled Dog server.', 1)
        if 300 <= status < 400:
            raise Failure('Server redirected the request. Update the server URL; credentials were not forwarded.')
        if status in (400, 422):
            raise Failure('Server rejected the request: check field values.', 2)
        if status >= 400:
            raise Failure(f'Server request failed (HTTP {status}).')
        try:
            return response.json()
        except ValueError:
            raise Failure('Server returned an invalid response.') from None


def ticket_ref(value):
    match = re.fullmatch(r'(?:SD-)?([1-9][0-9]*)', value, re.I)
    if not match:
        raise Failure('Ticket reference must look like SD-12.', 2)
    return 'SD-' + match.group(1)


def subtask_ref(value):
    match = re.fullmatch(r'(?:SD-)?([1-9][0-9]*)\.([1-9][0-9]*)', value, re.I)
    if not match:
        raise Failure('Subtask reference must look like SD-12.2.', 2)
    return 'SD-' + match.group(1), int(match.group(2))


def add_parsers(subs, common, Parser):
    server = subs.add_parser('server').add_subparsers(dest='action', required=True)
    p = server.add_parser('login', parents=[common], help='Connect to a Sled Dog server')
    p.add_argument('--url', required=True)
    p.add_argument('--with-token', action='store_true', help='Read the API token from stdin')
    server.add_parser('status', parents=[common])
    server.add_parser('sync', parents=[common], help='Pull GitHub pull requests now and update linked tickets')

    ticket = subs.add_parser('ticket').add_subparsers(dest='action', required=True)
    p = ticket.add_parser('list', parents=[common])
    p.add_argument('--status', choices=STATUSES)
    p.add_argument('--assignee')
    p.add_argument('--limit', type=int, default=50)
    p = ticket.add_parser('view', parents=[common])
    p.add_argument('reference')
    for name in ('create', 'update'):
        p = ticket.add_parser(name, parents=[common])
        if name == 'create':
            p.add_argument('title')
        else:
            p.add_argument('reference')
            p.add_argument('--title')
        p.add_argument('--body')
        p.add_argument('--status', choices=STATUSES)
        p.add_argument('--priority', choices=PRIORITIES)
        p.add_argument('--assignee', help='Login to assign; empty string unassigns')
        p.add_argument('--dry-run', action='store_true', help='Show what would change without writing')
        if name == 'create':
            p.add_argument('--idempotency-key', help='Retry-safe key (generated if omitted and printed in meta)')


    subtask = subs.add_parser('subtask', help='Split a ticket into subtasks (SD-12.1), each with its own PRs').add_subparsers(dest='action', required=True)
    p = subtask.add_parser('add', parents=[common])
    p.add_argument('ticket', help='Parent ticket, e.g. SD-12')
    p.add_argument('title')
    p.add_argument('--assignee', help='Login to assign')
    p.add_argument('--dry-run', action='store_true', help='Show what would happen without writing')
    p.add_argument('--idempotency-key', help='Retry-safe key (generated if omitted and printed in meta)')
    p = subtask.add_parser('update', parents=[common])
    p.add_argument('reference', help='Subtask, e.g. SD-12.2')
    p.add_argument('--title')
    p.add_argument('--status', choices=STATUSES)
    p.add_argument('--assignee', help='Login to assign; empty string unassigns')
    p.add_argument('--dry-run', action='store_true')
    p = subtask.add_parser('remove', parents=[common])
    p.add_argument('reference', help='Subtask, e.g. SD-12.2')
    p.add_argument('--dry-run', action='store_true')


def run_subtask(client, args):
    params = {'dry_run': '1'} if args.dry_run else None
    if args.action == 'add':
        body = {'title': args.title}
        if args.assignee is not None:
            body['assignee'] = args.assignee or None
        key = args.idempotency_key or str(uuid.uuid4())
        result = client.request('POST', f'/api/tickets/{ticket_ref(args.ticket)}/subtasks', params, body, idempotency_key=key)
        result['meta']['idempotency_key'] = key
        return result
    ticket, number = subtask_ref(args.reference)
    path = f'/api/tickets/{ticket}/subtasks/{number}'
    if args.action == 'remove':
        return client.request('DELETE', path, params)
    fields = {k: getattr(args, k) for k in ('title', 'status') if getattr(args, k, None) is not None}
    if args.assignee is not None:
        fields['assignee'] = args.assignee or None
    if not fields:
        raise Failure('Nothing to update. Pass at least one field.', 2)
    return client.request('PATCH', path, params, fields)


def run(args, config, secrets_factory, platform_factory=Platform, read_stdin=None):
    import sys
    meta = {'fetched_at': now(), 'complete': True}
    if args.command == 'server' and args.action == 'login':
        url = server_url(args.url)
        if not args.with_token:
            raise Failure('Use --with-token and pipe the API token on stdin.', 2)
        stdin = read_stdin or sys.stdin
        if stdin.isatty():
            raise Failure('Pipe the token to --with-token.', 2)
        token = stdin.read().strip()
        if not token:
            raise Failure('No token provided.', 3)
        client = platform_factory(url, token)
        try:
            client.request('GET', '/api/tickets', {'limit': 1})  # verify before saving
        finally:
            client.close()
        secrets_factory().put(credential_host(url), 'api-token', token)
        config.data['server'] = url
        config.save()
        return {'schema_version': 1, 'data': {'action': 'server-login', 'url': url}, 'meta': meta, 'errors': []}, 0

    url = os.environ.get('SLED_DOG_SERVER') or config.data.get('server')
    if not url:
        raise Failure('No server configured. Run sled-dog server login --url URL --with-token.', 3)
    url = server_url(url)
    meta['server'] = url
    if args.command == 'server' and args.action == 'status':
        return {'schema_version': 1, 'data': {'url': url}, 'meta': meta, 'errors': []}, 0
    token = os.environ.get('SLED_DOG_API_TOKEN') or secrets_factory().get(credential_host(url), 'api-token')
    if not token:
        raise Failure('No API token. Run sled-dog server login or set SLED_DOG_API_TOKEN.', 3)

    client = platform_factory(url, token)
    try:
        if args.command == 'subtask':
            result = run_subtask(client, args)
            result['meta'] = dict(meta, **result.get('meta', {}), kind='subtasks')
            return result, 0
        if args.command == 'server':  # sync
            result = client.request('POST', '/api/sync')
            result['meta'] = dict(meta, **result.get('meta', {}), kind='sync')
            return result, 0 if result['meta'].get('complete', True) else 4
        if args.action == 'list':
            if not 1 <= args.limit <= 200:
                raise Failure('--limit must be between 1 and 200.', 2)
            params = {k: v for k, v in {'status': args.status, 'assignee': args.assignee, 'limit': args.limit}.items() if v}
            result = client.request('GET', '/api/tickets', params)
        elif args.action == 'view':
            result = client.request('GET', f'/api/tickets/{ticket_ref(args.reference)}')
        else:
            fields = {k: getattr(args, k) for k in ('title', 'body', 'status', 'priority') if getattr(args, k, None) is not None}
            if args.assignee is not None:
                fields['assignee'] = args.assignee or None
            params = {'dry_run': '1'} if args.dry_run else None
            if args.action == 'create':
                key = args.idempotency_key or str(uuid.uuid4())
                result = client.request('POST', '/api/tickets', params, fields, idempotency_key=key)
                result['meta']['idempotency_key'] = key
            else:
                if not fields:
                    raise Failure('Nothing to update. Pass at least one field.', 2)
                result = client.request('PATCH', f'/api/tickets/{ticket_ref(args.reference)}', params, fields)
    finally:
        client.close()
    result['meta'] = dict(meta, **result.get('meta', {}), kind='tickets')
    return result, 0 if result['meta'].get('complete', True) else 4


def render_tickets(data, console, safe):
    from rich.table import Table
    from rich.text import Text
    rows = data if isinstance(data, list) else [data]
    colors = STATUS_COLORS
    table = Table(box=None, pad_edge=False, show_header=True, header_style='dim')
    for column in ('ID', 'Status', 'Priority', 'Assignee', 'Title'):
        table.add_column(column, overflow='fold')
    for row in rows:
        status = row.get('status', '')
        table.add_row(Text(safe(row.get('id', 'new')), style='cyan'), Text(safe(status.replace('_', ' ')), style=colors.get(status, '')),
                      safe(row.get('priority', '')), safe(row.get('assignee') or '-'), safe(row.get('title', '')))
    console.print(table)
    if not isinstance(data, list):
        render_subtask_list(data.get('subtasks') or [], console, safe)
        render_pull_requests(data.get('pullRequests') or [], console, safe)


def pr_chips(prs, safe):
    from rich.text import Text
    states = {'open': 'green', 'merged': 'magenta', 'closed': 'red'}
    marks = {'success': ' ✓', 'failure': ' ✕', 'pending': ' …'}
    line = Text()
    for pr in prs:
        if len(line):
            line.append('  ')
        line.append(safe(f"#{pr['number']} {'draft' if pr.get('draft') else pr['state']}") + marks.get(pr.get('checks'), ''), style='yellow' if pr.get('draft') else states.get(pr['state'], ''))
    return line


def render_subtask_list(subtasks, console, safe):
    from rich.table import Table
    from rich.text import Text
    if not subtasks:
        return
    console.print()
    console.print('Subtasks', style='bold')
    table = Table(box=None, pad_edge=False, show_header=False)
    for _ in range(5):
        table.add_column(overflow='fold')
    for s in subtasks:
        status = s.get('status', '')
        table.add_row(Text(safe(s.get('ref', '')), style='cyan'), Text(safe(status.replace('_', ' ')), style=STATUS_COLORS.get(status, '')),
                      safe(s.get('title', '')), Text(safe('@' + s['assignee']) if s.get('assignee') else '', style='dim'), pr_chips(s.get('pullRequests') or [], safe))
    console.print(table)


def render_subtasks(data, meta, console, safe):
    from rich.text import Text
    if 'deleted' in data:
        ref = data.get('ref') or f"subtask {data['deleted']}"
        console.print(Text(safe(('Would remove ' if meta.get('dry_run') else 'Removed ') + ref)), style='yellow' if meta.get('dry_run') else 'green')
    else:
        render_subtask_list([data], console, safe)
    if meta.get('dry_run'):
        console.print('Dry run: nothing was written.', style='yellow')
    moved = meta.get('ticketMoved') or meta.get('wouldMoveTicket')
    if moved:
        verb = 'Would move' if meta.get('dry_run') else 'Ticket moved:'
        console.print(safe(f"{verb} {moved['ticket']} {moved['from'].replace('_', ' ')} -> {moved['to'].replace('_', ' ')}"), style='cyan')


def render_pull_requests(prs, console, safe):
    from rich.text import Text
    if not prs:
        return
    console.print()
    console.print('Pull requests', style='bold')
    states = {'open': 'green', 'merged': 'magenta', 'closed': 'red'}
    ci = {'success': ('passing', 'green'), 'failure': ('failing', 'red'), 'pending': ('running', 'yellow'), 'none': ('no checks', 'dim')}
    for pr in prs:
        label, color = ci.get(pr.get('checks'), ('unknown', 'dim'))
        line = Text('  ' + safe(pr['key']), style='cyan')
        line.append('  ' + ('draft' if pr.get('draft') else safe(pr['state'])), style=states.get(pr['state'], '') if not pr.get('draft') else 'yellow')
        line.append('  CI ' + label, style=color)
        if pr.get('reviewDecision'):
            line.append('  review ' + safe(pr['reviewDecision'].replace('_', ' ')), style='dim')
        console.print(line)
        console.print(safe('    ' + pr['title']), style='dim')
        console.print(safe('    ' + pr['url']), style='dim')


def render_sync(data, console, safe):
    from rich.text import Text
    for row in data:
        if row.get('error'):
            console.print(Text(safe(f"{row['source']}: {row['error']}"), style='red'))
            continue
        line = f"{row['source']}: {row['prsSeen']} PR(s) seen, {row['linked']} newly linked"
        console.print(safe(line), style='green')
        for move in row['transitions']:
            console.print(safe(f"  {move['ticket']}: {move['from'].replace('_', ' ')} -> {move['to'].replace('_', ' ')}"))
        if row.get('truncated'):
            console.print('  More PRs remain; run sync again.', style='yellow')
    if not data:
        console.print('No GitHub sources configured. Add one in the web app under GitHub.', style='yellow')
