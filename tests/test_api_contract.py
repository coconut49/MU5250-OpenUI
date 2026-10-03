"""The API contract checker must compare method + path and never skip a binding."""
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('contract', ROOT / 'scripts/check-api-contract.py')
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)

SERVER = '''
    (&Method::Get, "/api/wifi/status") => wifi::status(state),
    (&Method::Put, "/api/wifi/settings") => wifi::set(state, body),
    (&Method::Delete, "/api/ttl/clear") => ttl::clear(state),
'''
MOCK = '''
ROUTES_PUT = {
    "/api/wifi/settings": put_wifi_settings,
}

ROUTES_GET = {
    "/api/wifi/status": lambda: STATE["wifi"],
}

ROUTES_POST = {
}

class Handler:
    def do_DELETE(self):
        if path == "/api/ttl/clear":
            pass
'''
GOOD = '''
  wifiStatus: () => get('/api/wifi/status').then(mapWifi),
  wifiSet: (body) => put('/api/wifi/settings', body),
  ttlClear: () => req('DELETE', '/api/ttl/clear'),
'''


def run(server=SERVER, dashboard=GOOD, mock=MOCK):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        ok = contract.check(server, [dashboard], mock)
    return ok, out.getvalue()


class ContractCheck(unittest.TestCase):
    def test_matching_surfaces_pass(self):
        self.assertTrue(run()[0])

    def test_method_mismatch_fails(self):
        ok, out = run(dashboard=GOOD.replace("put('/api/wifi/settings'", "get('/api/wifi/settings'"))
        self.assertFalse(ok)
        self.assertIn('GET    /api/wifi/settings', out)

    def test_mock_method_mismatch_fails(self):
        ok, out = run(mock=MOCK.replace('ROUTES_PUT = {\n    "/api/wifi/settings"', 'ROUTES_POST_X = {\n    "/api/wifi/settings"')
                      .replace('ROUTES_POST = {\n}', 'ROUTES_POST = {\n    "/api/wifi/settings": f,\n}'))
        self.assertFalse(ok)
        self.assertIn('POST   /api/wifi/settings', out)

    def test_unrecognised_binding_form_fails(self):
        ok, out = run(dashboard=GOOD + "\n  other: () => fetch(`${API_BASE}/api/wifi/status`),\n  x: () => send('/api/ttl/clear'),")
        self.assertFalse(ok)
        self.assertIn('outside a recognised binding', out)

    def test_comparison_literal_is_not_a_call(self):
        ok, _ = run(dashboard=GOOD + "\n if (path !== '/api/wifi/status') {}")
        self.assertTrue(ok)

    def test_missing_route_and_dead_route_fail(self):
        self.assertFalse(run(dashboard=GOOD.replace("req('DELETE', '/api/ttl/clear')", "req('DELETE', '/api/ttl/wipe')"))[0])

    def test_real_tree_agrees(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            ok = contract.check(contract.read(contract.SERVER_RS),
                                [contract.read(contract.API_TS), contract.read(contract.CLIENT_TS)],
                                contract.read(contract.MOCK_PY))
        self.assertTrue(ok, out.getvalue())
