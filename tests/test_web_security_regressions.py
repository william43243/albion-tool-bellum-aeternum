from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
APP_NGINX = (ROOT / "nginx.conf").read_text(encoding="utf-8")
GATEWAY_PATH = Path("/srv/migrated-sites/gateway/nginx.conf")
GATEWAY = GATEWAY_PATH.read_text(encoding="utf-8")
SITE = ROOT / "site"


def albion_gateway_blocks() -> list[str]:
    blocks = []
    for match in re.finditer(r"\bserver\s*\{", GATEWAY):
        depth = 0
        for index in range(match.start(), len(GATEWAY)):
            if GATEWAY[index] == "{":
                depth += 1
            elif GATEWAY[index] == "}":
                depth -= 1
                if depth == 0:
                    block = GATEWAY[match.start():index + 1]
                    if re.search(r"server_name\s+albion-tool-bellum-aeternum\.com[^;]*;", block):
                        blocks.append(block)
                    break
    return blocks


def test_plain_http_is_only_a_permanent_https_redirect():
    blocks = albion_gateway_blocks()
    http = [b for b in blocks if re.search(r"listen\s+80\s*;", b)]
    assert len(http) == 1
    assert "return 308 https://$host$request_uri;" in http[0]
    assert "proxy_pass" not in http[0]


def test_tls_gateway_never_generates_http_locations():
    blocks = albion_gateway_blocks()
    tls = [b for b in blocks if re.search(r"listen\s+443\s+ssl\s*;", b)]
    assert len(tls) == 1
    assert not re.search(r"listen\s+80\s*;", tls[0])
    assert "proxy_set_header X-Forwarded-Proto https;" in tls[0]
    assert "proxy_redirect http:// https://;" in tls[0]
    assert "absolute_redirect off;" in APP_NGINX


def test_gateway_emits_one_canonical_security_policy():
    tls = next(b for b in albion_gateway_blocks() if "listen 443 ssl;" in b)
    for header in (
        "X-Frame-Options",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Content-Security-Policy",
        "Strict-Transport-Security",
    ):
        assert f"proxy_hide_header {header};" in tls
        assert len(re.findall(rf"add_header\s+{re.escape(header)}\b", tls)) == 1


def test_csp_removes_unsafe_script_execution_and_broad_egress():
    policies = re.findall(r'Content-Security-Policy\s+"([^"]+)"', GATEWAY)
    assert policies
    for policy in policies:
        script = re.search(r"script-src\s+([^;]+)", policy)
        connect = re.search(r"connect-src\s+([^;]+)", policy)
        assert script
        assert "'unsafe-inline'" not in script.group(1)
        assert "'unsafe-eval'" not in script.group(1)
        assert connect
        assert not re.search(r"(?:^|\s)https:(?:\s|$)", connect.group(1))
        assert not re.search(r"(?:^|\s)wss:(?:\s|$)", connect.group(1))


def test_admin_ui_and_private_stats_api_are_not_public():
    tls = next(b for b in albion_gateway_blocks() if "listen 443 ssl;" in b)
    assert re.search(r"location\s+\^~\s+/admin/?.*?return\s+404", tls, re.S)
    assert re.search(r"location\s+\^~\s+/api/stats/.*?return\s+404", tls, re.S)
    assert re.search(r"location\s+=\s+/api/stats/public\s*\{.*?proxy_pass", tls, re.S)


def test_rate_limits_use_validated_client_identity():
    assert "limit_req_zone $http_x_real_ip zone=tracking" in APP_NGINX
    assert "limit_req_zone $http_x_real_ip zone=admin" in APP_NGINX
    assert "limit_req_zone $http_x_real_ip zone=public_api" in APP_NGINX


def test_haproxy_only_routes_cloudflare_sources_to_the_web_gateway():
    import ipaddress

    snippet = (ROOT / "deploy/haproxy-cloudflare-allowlist.cfg").read_text(encoding="utf-8")
    ranges = (ROOT / "deploy/cloudflare-ips.lst").read_text(encoding="utf-8").splitlines()
    assert "acl cloudflare_src src -f /etc/haproxy/cloudflare-ips.lst" in snippet
    assert "use_backend migrated_sites_tls if migrated_web cloudflare_src" in snippet
    assert len(ranges) >= 20
    assert any(ipaddress.ip_network(line).version == 4 for line in ranges)
    assert any(ipaddress.ip_network(line).version == 6 for line in ranges)


def test_declarative_deployment_matches_running_hardening():
    compose = (ROOT / "deploy/compose.yaml").read_text(encoding="utf-8")
    assert "image: albion-market:security-20260821" in compose
    assert '"127.0.0.1:2053:443"' in compose
    assert "mkdir -p /run/nginx" not in compose


def test_no_inline_or_third_party_executable_assets():
    html_files = [SITE / "index.html", SITE / "admin/index.html", SITE / "cgu.html", SITE / "confidentialite.html"]
    for path in html_files:
        html = path.read_text(encoding="utf-8")
        assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html, re.I), path
        assert "cdn.jsdelivr.net" not in html, path
        assert not re.search(r"<style(?:\s[^>]*)?>", html, re.I), path


def test_chartjs_is_self_hosted_and_pinned():
    admin = (SITE / "admin/index.html").read_text(encoding="utf-8")
    vendor = SITE / "vendor/chart.umd.min.js"
    assert 'src="/vendor/chart.umd.min.js"' in admin
    assert vendor.is_file()
    assert vendor.stat().st_size > 100_000


def test_admin_secret_is_read_from_a_file_not_an_environment_value():
    server = (ROOT / "analytics/server.js").read_text(encoding="utf-8")
    assert "ADMIN_TOKEN_FILE" in server
    assert "process.env.ADMIN_TOKEN ||" not in server
    assert "app.disable('x-powered-by')" in server


def test_hardened_runtime_initializes_tmpfs_and_readable_code():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    entrypoint = (ROOT / "docker-entrypoint.sh").read_text(encoding="utf-8")
    supervisor = (ROOT / "supervisord.conf").read_text(encoding="utf-8")
    assert "chmod -R a=rX /opt/analytics /usr/share/nginx/html" in dockerfile
    assert "mkdir -p /run/nginx /var/lib/nginx/tmp/client_body /var/lib/nginx/logs" in entrypoint
    assert "pidfile=/tmp/supervisord.pid" in supervisor


if __name__ == "__main__":
    failures = []
    tests = sorted((name, obj) for name, obj in globals().items() if name.startswith("test_") and callable(obj))
    for name, test in tests:
        try:
            test()
            print(f"PASS {name}")
        except Exception as exc:
            failures.append((name, exc))
            print(f"FAIL {name}: {exc}")
    print(f"RESULT total={len(tests)} passed={len(tests) - len(failures)} failed={len(failures)}")
    raise SystemExit(1 if failures else 0)
