"""Inspect only technical publication and reference identities in a stopped fixture."""
import json
import sqlite3
import sys

database = sqlite3.connect(sys.argv[1])
row = database.execute('SELECT active,versionId,activeVersionId,nodes FROM workflow_entity WHERE id=?', ('0S5ZS1xeDCSoWovs',)).fetchone()
nodes = json.loads(row[3])
print(json.dumps({
    'active': bool(row[0]),
    'version': row[1],
    'published_version': row[2],
    'users': database.execute('SELECT count(*) FROM user').fetchone()[0],
    'credentials': database.execute('SELECT count(*) FROM credentials_entity').fetchone()[0],
    'openai_reference_preserved': any(node.get('credentials', {}).get('openAiApi', {}).get('id') == 'synthetic-local-openai-reference' for node in nodes),
}))
