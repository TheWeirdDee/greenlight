import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCheckableUrl, createUrlChecker, isNonPublicIp } from "./url-check";

describe("SSRF guard", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  ])("blocks non-public address %s", (ip) => expect(isNonPublicIp(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"])("allows public address %s", (ip) =>
    expect(isNonPublicIp(ip)).toBe(false),
  );

  it("refuses unsafe URL shapes before any network activity", () => {
    expect(() => assertCheckableUrl("http://example.com")).toThrow(/https/);
    expect(() => assertCheckableUrl("ftp://example.com")).toThrow();
    expect(() => assertCheckableUrl("https://user:pw@example.com")).toThrow(/credentials/);
    expect(() => assertCheckableUrl("https://127.0.0.1/")).toThrow(/domain name/);
    expect(() => assertCheckableUrl("https://[::1]/")).toThrow(/domain name/);
    expect(() => assertCheckableUrl("https://example.com:6379/")).toThrow(/ports/);
    expect(() => assertCheckableUrl("javascript:alert(1)")).toThrow();
    expect(assertCheckableUrl("https://example.com/path?x=1").hostname).toBe("example.com");
  });
});

describe("URL checker refuses to reach internal services", () => {
  let server: http.Server;
  let hits = 0;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits += 1;
      res.writeHead(200).end("internal");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it("never connects to a loopback server, even when the hostname is a domain that resolves to it", async () => {
    // localhost resolves to 127.0.0.1 / ::1; the connect-time guard must refuse it.
    const checker = createUrlChecker({ allowHttp: true, allowAnyPort: true });
    const res = await checker.check(`http://localhost:${port}/`);
    expect(res.ok).toBe(false);
    expect(hits).toBe(0);
  });

  it("rejects IP-literal targets outright", async () => {
    const res = await createUrlChecker({ allowHttp: true, allowAnyPort: true }).check(`http://127.0.0.1:${port}/`);
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/domain name/);
    expect(hits).toBe(0);
  });

  it("reports malformed input as a failed check rather than throwing", async () => {
    const res = await createUrlChecker().check("not a url");
    expect(res).toMatchObject({ ok: false, status: null });
  });
});
