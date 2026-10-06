"""Read an isolated, stopped n8n SQLite profile; emit categories, never values."""
import json
import sqlite3
import sys


def unflatten(serialized):
    values = json.loads(serialized)
    resolved = {}

    def at(index):
        if index in resolved:
            return resolved[index]
        value = values[index]
        if isinstance(value, dict):
            result = {}
            resolved[index] = result
            result.update({key: ref(item) for key, item in value.items()})
            return result
        if isinstance(value, list):
            result = []
            resolved[index] = result
            result.extend(ref(item) for item in value)
            return result
        return value

    def ref(value):
        return at(int(value)) if isinstance(value, str) else value

    return at(0)


def binary_count(value):
    if isinstance(value, dict):
        return int('binary' in value) + sum(binary_count(item) for item in value.values())
    if isinstance(value, list):
        return sum(binary_count(item) for item in value)
    return 0


def binary_reference_count(value):
    if isinstance(value, dict):
        return sum(binary_reference_count(item) for item in value.values())
    if isinstance(value, list):
        return sum(binary_reference_count(item) for item in value)
    return int(isinstance(value, str) and value.startswith(('filesystem:', 'filesystem-v2:', 's3:', 'database:')))


database = sqlite3.connect(sys.argv[1])
rows = database.execute('SELECT data FROM execution_data').fetchall()
summary = {
    'rows': len(rows),
    'soft_deleted': database.execute('SELECT count(*) FROM execution_entity WHERE deletedAt IS NOT NULL').fetchone()[0],
    'binary_properties': 0,
    'binary_references': 0,
    'saved_run_nodes': 0,
    'initial_webhook_only': True,
    'initial_body_fields': [],
    'possible_pii_categories': [],
}
body_fields = set()
sensitive = set()
for (serialized,) in rows:
    decoded = unflatten(serialized)
    summary['binary_properties'] += binary_count(decoded)
    summary['binary_references'] += binary_reference_count(decoded)
    summary['saved_run_nodes'] += len(decoded.get('resultData', {}).get('runData', {}))
    stack = decoded.get('executionData', {}).get('nodeExecutionStack', [])
    summary['initial_webhook_only'] &= len(stack) == 1 and stack[0].get('node', {}).get('type') == 'n8n-nodes-base.webhook'
    for frame in stack:
        for output in frame.get('data', {}).get('main', []):
            for item in output or []:
                payload = item.get('json', {})
                body = payload.get('body', {})
                body_fields.update(body)
                if body.get('to'):
                    sensitive.add('recipient')
                if body.get('message', {}).get('caption'):
                    sensitive.add('caption')
                if payload.get('headers', {}).get('authorization'):
                    sensitive.add('authorization_header')
summary['initial_body_fields'] = sorted(body_fields)
summary['possible_pii_categories'] = sorted(sensitive)
print(json.dumps(summary))
