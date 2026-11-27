"""Proxy only the existing SCVM Glue API contracts, to the local Glue service."""
import json
import re
import ssl
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from glue_catalog import operation


def parameters(body):
    definition = operation(body['service'], body.get('action', 'list'))
    values = body.get('values', {})
    if not isinstance(values, dict):
        raise ValueError('스토리지 서비스 설정 형식을 확인해 주세요.')
    accepted = {field['name'] for field in definition['fields']}
    if set(values) - accepted:
        raise ValueError('지원하지 않는 스토리지 서비스 입력값입니다.')
    normalized = {}
    for field in definition['fields']:
        value = values.get(field['name'], field['default'])
        if field['required'] and (value is None or value == '' or value == []):
            raise ValueError(field['label'] + ' 항목을 입력해 주세요.')
        if value == '' or value is None:
            continue
        if field.get('options') and value not in field['options']:
            raise ValueError(field['label'] + ' 값을 확인해 주세요.')
        if field['type'] == 'multiple' and isinstance(value, str):
            value = [part.strip() for part in re.split(r'[\n,]+', value) if part.strip()]
        if isinstance(value, list):
            if not value or any(not isinstance(item, str) or '\0' in item for item in value):
                raise ValueError(field['label'] + ' 목록을 확인해 주세요.')
        elif not isinstance(value, (str, int, float, bool)) or '\0' in str(value):
            raise ValueError(field['label'] + ' 값을 확인해 주세요.')
        normalized[field['name']] = value
    return definition, normalized


def execute(adapter, body):
    definition, values = parameters(body)
    path = definition['path']
    placeholders = re.findall(r'{(\w+)}', path)
    for field in placeholders:
        value = str(values[field])
        if value in ('.', '..') or '/' in value or '\\' in value:
            raise ValueError('서비스 이름 또는 ID를 확인해 주세요.')
        path = path.replace('{' + field + '}', quote(value, safe=''))
    query = {key: value for key, value in values.items()
             if key in definition['query'] or (definition['method'] == 'GET' and key not in placeholders)}
    if query:
        path += ('&' if '?' in path else '?') + urlencode(query, doseq=True)
    contents = {key: value for key, value in values.items() if key not in placeholders and key not in definition['query']}
    if body['service'] == 'iscsi' and body.get('action') == 'target-delete':
        contents['iqn_id'] = values['iqn_id']
    if body['service'] == 'nvmeof' and body.get('action') == 'target-delete':
        contents['nqn_id'] = values['subsystem_nqn_id']
    if body['service'] == 'gateway' and body.get('action') == 'deploy':
        contents['hypervisorType'] = 'cell'
    port = int(adapter.read_json(adapter.PROPERTIES / 'glue_conf.json').get('apiPort', 8080))
    if not 1 <= port <= 65535:
        raise ValueError('스토리지 서비스 포트 설정을 확인해 주세요.')
    data = urlencode(contents, doseq=True).encode() if definition['method'] != 'GET' else None
    request = Request('https://127.0.0.1:' + str(port) + path, data=data, method=definition['method'],
                      headers={'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        # Preserve the existing Glue host-certificate behavior, restricted to loopback.
        with urlopen(request, timeout=30 if definition['method'] == 'GET' else 7200, context=ssl._create_unverified_context()) as response:
            raw = response.read()
        result = json.loads(raw) if raw else None
    except HTTPError as error:
        details = error.read().decode('utf-8', 'replace')
        raise RuntimeError('스토리지 서비스 요청 실패 (' + str(error.code) + '): ' + details[-2000:])
    if isinstance(result, dict) and str(result.get('code', 200)).isdigit() and int(result.get('code', 200)) >= 400:
        raise RuntimeError(str(result.get('message') or result.get('val') or result))
    if definition['method'] != 'GET':
        confirmed = (isinstance(result, str) and result.strip().lower() in ('success', 'ok')) or (
            isinstance(result, dict) and str(result.get('code')) in ('200', '201', '202', '204'))
        if not confirmed:
            raise RuntimeError('스토리지 서비스 작업의 성공을 확인하지 못했습니다: ' + str(result)[:1000])
    return {'code': 200, 'val': result}
