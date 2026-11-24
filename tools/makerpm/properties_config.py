#!/usr/bin/python3
"""Keep live property values and add new packaged defaults during RPM upgrades.

RPM embeds this complete, standalone program in its pre-install scriptlet, so
capturing values also works when upgrading a package without this helper.
Lists and scalars are values; only JSON objects are merged recursively.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

PROPERTIES = Path('/usr/share/cockpit/ablestack/tools/properties')
DEFAULTS = Path('/usr/share/cockpit/ablestack/tools/makerpm/property-defaults')
STATE = Path('/var/lib/ablestack/properties-upgrade/pending.json')


class ConfigError(ValueError):
    pass


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ConfigError('Duplicate JSON key')
        value[key] = item
    return value


def invalid_constant(_value):
    raise ConfigError('Non-standard JSON number')


def read_json(path):
    if path.is_symlink() or not path.is_file():
        raise ConfigError('Expected a regular JSON file: ' + str(path))
    try:
        with path.open(encoding='utf-8') as stream:
            return json.load(stream, object_pairs_hook=unique_object, parse_constant=invalid_constant)
    except (ValueError, UnicodeError):
        raise ConfigError('Invalid JSON; file left unchanged: ' + str(path)) from None


def property_files(directory):
    if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
        raise ConfigError('Expected a regular properties directory: ' + str(directory))
    for path in sorted(directory.rglob('*.json')):
        relative = path.relative_to(directory)
        if ('.cube-agent.json' in path.name
                or path.name.startswith(('.cube-setup-', '.properties-merge-'))):
            continue
        if path.is_symlink() or not path.is_file():
            raise ConfigError('Expected a regular property file: ' + str(path))
        yield relative, path


def check_parents(path, directory):
    for relative in path.relative_to(directory).parents:
        parent = directory / relative
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise ConfigError('Property path must not contain symlinks: ' + str(path))


def atomic_json(path, value, metadata=None):
    """Replace within the same directory, keeping ownership/mode and file labels."""
    descriptor, temporary = tempfile.mkstemp(prefix='.properties-merge-', dir=str(path.parent))
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=4, allow_nan=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            if path.is_symlink() or not path.is_file():
                raise ConfigError('Refusing to replace a non-regular file: ' + str(path))
            shutil.copystat(path, temporary, follow_symlinks=False)
        if metadata is not None:
            current = temporary.stat()
            if (current.st_uid, current.st_gid) != (metadata['uid'], metadata['gid']):
                os.chown(temporary, metadata['uid'], metadata['gid'])
            temporary.chmod(metadata['mode'])
        else:
            temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def capture(properties, state):
    if state.exists() or state.is_symlink():
        raise ConfigError('Unfinished property merge: ' + str(state)
                          + '. Run properties_config.py merge before retrying the RPM update.')
    files = {}
    for relative, path in property_files(properties):
        info = path.stat()
        files[relative.as_posix()] = dict(data=read_json(path), mode=stat.S_IMODE(info.st_mode),
                                         uid=info.st_uid, gid=info.st_gid)
    state.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if (state.parent.is_symlink() or state.parent.stat().st_uid != os.geteuid()
            or stat.S_IMODE(state.parent.stat().st_mode) != 0o700):
        raise ConfigError('Property merge state directory must be private and owned by the installer: ' + str(state.parent))
    atomic_json(state, dict(format=1, files=files))


def merge_values(defaults, existing):
    if not isinstance(defaults, dict) or not isinstance(existing, dict):
        return copy.deepcopy(existing)
    result = copy.deepcopy(defaults)
    for key, value in existing.items():
        result[key] = merge_values(defaults[key], value) if key in defaults else copy.deepcopy(value)
    return result


def stage_defaults(properties, defaults):
    # Validate every packaged JSON before copying any of them.
    files = [(relative, path, read_json(path)) for relative, path in property_files(properties)]
    if not files:
        raise ConfigError('No packaged property defaults were found.')
    for relative, path, _value in files:
        target = defaults / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        target.chmod(0o644)


def merge(properties, defaults, state):
    snapshot = read_json(state)
    if not isinstance(snapshot, dict) or snapshot.get('format') != 1 or not isinstance(snapshot.get('files'), dict):
        raise ConfigError('Invalid property merge state: ' + str(state))
    plan = []
    for relative, default_path in property_files(defaults):
        target = properties / relative
        check_parents(target, properties)
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ConfigError('Refusing to replace a non-regular property file: ' + str(target))
        new_defaults = read_json(default_path)
        saved = snapshot['files'].get(relative.as_posix())
        if saved is not None:
            value = merge_values(new_defaults, saved['data'])
            metadata = saved
        elif target.exists():
            info = target.stat()
            value = merge_values(new_defaults, read_json(target))
            metadata = dict(mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
        else:
            value = new_defaults
            metadata = dict(mode=0o644, uid=os.geteuid(), gid=os.getegid())
        plan.append((target, value, metadata))
    if not plan:
        raise ConfigError('Packaged property defaults are missing; merge state retained.')
    # A malformed default cannot leave some files merged and others unvalidated.
    for target, value, metadata in plan:
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(target, value, metadata)
    state.unlink()
    print('ABLESTACK property JSON merge completed; existing values preserved.')


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    # RPM supplies the installed-instance count to its embedded pre scriptlet.
    if len(argv) == 1 and argv[0].isdigit():
        argv = ['capture']
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('capture', 'merge', 'stage-defaults'))
    parser.add_argument('--properties-dir', type=Path, default=PROPERTIES)
    parser.add_argument('--defaults-dir', type=Path, default=DEFAULTS)
    parser.add_argument('--state-file', type=Path, default=STATE)
    args = parser.parse_args(argv)
    try:
        if args.action == 'capture':
            capture(args.properties_dir, args.state_file)
        elif args.action == 'stage-defaults':
            stage_defaults(args.properties_dir, args.defaults_dir)
        else:
            merge(args.properties_dir, args.defaults_dir, args.state_file)
        return 0
    except (ConfigError, OSError, KeyError, TypeError) as error:
        print('ERROR: ABLESTACK property merge failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
