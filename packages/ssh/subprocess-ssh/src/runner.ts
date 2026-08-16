/** Fixed Python process owner executed inside the pinned SSH world. */
export const PROCESS_RUNNER = String.raw`
import json, os, re, signal, subprocess, sys, threading

request = json.loads(sys.stdin.buffer.readline())
state = request['state']; token = request['token']
os.makedirs(os.path.dirname(state), mode=0o700, exist_ok=True)
os.makedirs(state, mode=0o700, exist_ok=False)
os.chmod(state, 0o700)
sensitive = re.compile(r'KEY|PASSWORD|SECRET|TOKEN', re.I)
env = {k:v for k,v in os.environ.items() if not sensitive.search(k) and not k.upper().startswith('DSH_')}
for key, value in request.get('env', {}).items():
    if value is None: env.pop(key, None)
    else: env[key] = value
env['SIVITACODE_PROCESS_ID'] = token
with open(os.path.join(state, 'token'), 'x', encoding='ascii') as stream:
    os.chmod(stream.fileno(), 0o600); stream.write(token)

process = subprocess.Popen(request['argv'], cwd=request['cwd'], env=env, stdin=subprocess.PIPE,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, bufsize=0)
with open(os.path.join(state, 'identity'), 'x', encoding='ascii') as stream:
    os.chmod(stream.fileno(), 0o600)
    stream.write(json.dumps({'pid': process.pid, 'pgid': os.getpgid(process.pid)}, separators=(',', ':')))
marker = ('\0SIVITACODE_PROCESS_READY ' + json.dumps({'pid': process.pid}, separators=(',', ':')) + '\n').encode()
sys.stderr.buffer.write(marker); sys.stderr.buffer.flush()

def copy_input():
    try:
        while True:
            data = sys.stdin.buffer.read(65536)
            if not data: break
            process.stdin.write(data); process.stdin.flush()
    except (BrokenPipeError, OSError): pass
    finally:
        try: process.stdin.close()
        except OSError: pass

def copy_output(source, target, spill):
    handle = None; total = 0; valid = spill is not None
    try:
        if valid:
            handle = open(spill['path'], 'xb', buffering=0); os.chmod(handle.fileno(), 0o600)
        while True:
            data = source.read(65536)
            if not data: break
            target.write(data); target.flush()
            if handle is not None:
                total += len(data)
                if total <= spill['maxBytes']: handle.write(data)
                else:
                    handle.close(); handle = None; os.unlink(spill['path']); valid = False
    finally:
        if handle is not None: handle.close()

threads = [
    threading.Thread(target=copy_input, daemon=True),
    threading.Thread(target=copy_output, args=(process.stdout, sys.stdout.buffer, request.get('stdoutSpill')), daemon=True),
    threading.Thread(target=copy_output, args=(process.stderr, sys.stderr.buffer, request.get('stderrSpill')), daemon=True),
]
for thread in threads: thread.start()
returncode = process.wait()
for thread in threads[1:]: thread.join()
outcome = {'exitCode': returncode if returncode >= 0 else None,
           'signal': None if returncode >= 0 else signal.Signals(-returncode).name}
temporary = os.path.join(state, 'outcome.tmp')
with open(temporary, 'x', encoding='ascii') as stream:
    os.chmod(stream.fileno(), 0o600); stream.write(json.dumps(outcome, separators=(',', ':'))); stream.flush(); os.fsync(stream.fileno())
os.replace(temporary, os.path.join(state, 'outcome'))
sys.exit(returncode if returncode >= 0 else 128 - returncode)
`

/** Fixed Python controller that finds descendants by an inherited unguessable process token. */
export const PROCESS_CONTROL = String.raw`
import json, os, re, shutil, signal, subprocess, sys
request = json.load(sys.stdin); state = request['state']
try:
    with open(os.path.join(state, 'token'), encoding='ascii') as stream: token = stream.read()
except FileNotFoundError:
    print(json.dumps({'alive': False, 'groups': [], 'outcome': None}, separators=(',', ':'))); sys.exit(0)
needle = 'SIVITACODE_PROCESS_ID=' + token; groups = set()
listing = subprocess.run(['ps', 'eww', '-A', '-o', 'pid=,pgid=,state=,tpgid=,command='],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors='replace', timeout=10)
if listing.returncode != 0:
    print('process inspection failed: ' + listing.stderr.strip(), file=sys.stderr); sys.exit(70)
for line in listing.stdout.splitlines():
    fields = line.strip().split(None, 4)
    if len(fields) != 5 or needle not in fields[4]: continue
    try:
        pid = int(fields[0]); group = int(fields[1])
    except ValueError: continue
    if fields[2][:1] not in ('Z', 'X', 'x') and pid > 1 and group > 1: groups.add(group)
action = request.get('action')
if action in ('TERM', 'KILL'):
    number = signal.SIGTERM if action == 'TERM' else signal.SIGKILL
    for group in groups:
        if group > 1:
            try: os.killpg(group, number)
            except ProcessLookupError: pass
outcome = None
try:
    with open(os.path.join(state, 'outcome'), encoding='ascii') as stream: outcome = json.load(stream)
except FileNotFoundError: pass
if request.get('cleanup') and not groups:
    expected = r'^/tmp/\.sivitacode-process-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    try:
        facts = os.lstat(state)
        if re.fullmatch(expected, state) and os.path.isdir(state) and not os.path.islink(state) and facts.st_uid == os.getuid():
            shutil.rmtree(state)
    except FileNotFoundError: pass
print(json.dumps({'alive': bool(groups), 'groups': sorted(groups), 'outcome': outcome}, separators=(',', ':')))
`

/** Fixed Python executable resolver for the remote POSIX world. */
export const RESOLVE_EXECUTABLE = String.raw`
import json, os, shutil, stat, sys
request = json.load(sys.stdin); command = request['command']; path = request.get('path')
if not command or ('/' in command and not os.path.isabs(command)):
    print(json.dumps({'ok': False}, separators=(',', ':'))); sys.exit(0)
candidate = command if os.path.isabs(command) else shutil.which(command, path=path)
ok = candidate is not None and os.path.isfile(candidate) and os.access(candidate, os.X_OK)
print(json.dumps({'ok': ok, 'path': os.path.realpath(candidate) if ok else None}, separators=(',', ':')))
`

/** Fixed bootstrap exec'd inside an OpenSSH-allocated pseudo-terminal. */
export const TERMINAL_RUNNER = String.raw`
import fcntl, json, os, re, struct, sys, termios
request = json.loads(sys.stdin.buffer.readline()); state = request['state']; token = request['token']
os.makedirs(state, mode=0o700, exist_ok=False); os.chmod(state, 0o700)
with open(os.path.join(state, 'token'), 'x', encoding='ascii') as stream:
    os.chmod(stream.fileno(), 0o600); stream.write(token)
rows = request['rows']; cols = request['cols']
fcntl.ioctl(sys.stdin.fileno(), termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
sensitive = re.compile(r'KEY|PASSWORD|SECRET|TOKEN', re.I)
env = {k:v for k,v in os.environ.items() if not sensitive.search(k) and not k.upper().startswith('DSH_')}
env.update(request.get('env', {})); env['SIVITACODE_TERMINAL_ID'] = token; env.setdefault('TERM', 'xterm-256color')
os.chdir(request['cwd'])
marker = ('\0SIVITACODE_TERMINAL_READY ' + json.dumps({'pid': os.getpid(), 'sid': os.getsid(0)}, separators=(',', ':')) + '\n').encode()
sys.stdout.buffer.write(marker); sys.stdout.buffer.flush()
os.execvpe(request['argv'][0], request['argv'], env)
`

/** Fixed controller for one token-owned remote terminal session. */
export const TERMINAL_CONTROL = String.raw`
import json, os, re, shutil, signal, subprocess, sys
request = json.load(sys.stdin); state = request['state']
try:
    with open(os.path.join(state, 'token'), encoding='ascii') as stream: token = stream.read()
except FileNotFoundError:
    print(json.dumps({'groups': [], 'foreground': None, 'inputWaiting': False}, separators=(',', ':'))); sys.exit(0)
needle = 'SIVITACODE_TERMINAL_ID=' + token; groups = set(); members = []
listing = subprocess.run(['ps', 'eww', '-A', '-o', 'pid=,pgid=,state=,tpgid=,command='],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors='replace', timeout=10)
if listing.returncode != 0:
    print('terminal inspection failed: ' + listing.stderr.strip(), file=sys.stderr); sys.exit(70)
for line in listing.stdout.splitlines():
    fields = line.strip().split(None, 4)
    if len(fields) != 5 or needle not in fields[4] or fields[2][:1] in ('Z', 'X', 'x'): continue
    try:
        pid = int(fields[0]); group = int(fields[1]); tpgid = int(fields[3])
    except ValueError: continue
    if pid > 1 and group > 1:
        groups.add(group); members.append((fields[2][:1], tpgid, group))
foreground = next((tpgid for _, tpgid, _ in members if tpgid > 1), None)
action = request.get('action'); requested = request.get('group')
targets = [requested] if requested is not None else list(groups)
if action in ('INT','TERM','KILL','TSTP','HUP'):
    number = getattr(signal, 'SIG' + action)
    for group in targets:
        if group is not None and group > 1:
            try: os.killpg(group, number)
            except ProcessLookupError: pass
waiting = foreground is not None and any(group == foreground and state == 'S' for state, _, group in members)
if request.get('cleanup') and not groups:
    expected = r'^/tmp/\.sivitacode-terminal-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    try:
        facts = os.lstat(state)
        if re.fullmatch(expected, state) and os.path.isdir(state) and not os.path.islink(state) and facts.st_uid == os.getuid():
            shutil.rmtree(state)
    except FileNotFoundError: pass
print(json.dumps({'groups': sorted(groups), 'foreground': foreground, 'inputWaiting': waiting}, separators=(',', ':')))
`

/** Bounded garbage collector for completed SSH state and spill directories. */
export const REMOTE_STATE_GC = String.raw`
import json, os, re, shutil, subprocess, sys, time
request = json.load(sys.stdin); minimum_age = request['minimumAgeSeconds']; now = time.time()
pattern = re.compile(r'^\.sivitacode-(process|terminal)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
listing = subprocess.run(['ps', 'eww', '-A', '-o', 'command='], stdout=subprocess.PIPE,
    stderr=subprocess.PIPE, text=True, errors='replace', timeout=10)
if listing.returncode != 0:
    print('state GC process inspection failed: ' + listing.stderr.strip(), file=sys.stderr); sys.exit(70)
environment = listing.stdout; removed = 0
for entry in os.scandir('/tmp'):
    if not pattern.fullmatch(entry.name): continue
    try:
        facts = entry.stat(follow_symlinks=False)
        if not entry.is_dir(follow_symlinks=False) or facts.st_uid != os.getuid() or now - facts.st_mtime < minimum_age: continue
        with open(os.path.join(entry.path, 'token'), encoding='ascii') as stream: token = stream.read()
        variable = 'SIVITACODE_PROCESS_ID=' if entry.name.startswith('.sivitacode-process-') else 'SIVITACODE_TERMINAL_ID='
        if variable + token in environment: continue
        shutil.rmtree(entry.path); removed += 1
    except (FileNotFoundError, NotADirectoryError, PermissionError, OSError): pass
print(json.dumps({'removed': removed}, separators=(',', ':')))
`
