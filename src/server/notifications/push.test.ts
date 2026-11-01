import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./push";

describe("isAllowedPushEndpoint", () => {
  it("accepts the real browser push services", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://jmt17.google.com/fcm/send/abc123",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGuQyavXut",
      "https://api.push.apple.com/3/device/abc",
      "https://wns2-db5p.notify.windows.com/w/?token=abc",
    ]) {
      expect([url, isAllowedPushEndpoint(url)]).toEqual([url, true]);
    }
  });

  it("refuses anything else, so a crafted subscription can't make the server call arbitrary hosts", () => {
    for (const url of [
      "http://fcm.googleapis.com/fcm/send/abc", // not https
      "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x", // look-alike host
      "https://evilpush.apple.com.attacker.net/x",
      "https://jmt17.google.com.attacker.net/x",
      "https://www.google.com/search?q=x", // other Google hosts are not push services
      "https://169.254.169.254/latest/meta-data", // cloud metadata
      "https://localhost/x",
      "https://user:pass@fcm.googleapis.com/x", // credentials in URL
      "https://fcm.googleapis.com:8443/x", // unusual port
      "not a url",
      "",
    ]) {
      expect([url, isAllowedPushEndpoint(url)]).toEqual([url, false]);
    }
  });
});
