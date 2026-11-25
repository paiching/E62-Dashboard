const { randomUUID } = require("node:crypto");

const TOKEN_URL = "https://api.line.me/oauth2/v3/token";
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 1000;

const PUSH_ERRORS = {
  400: "接收對象不存在，或尚未加官方帳號為好友／邀請進群組",
  401: "驗證失敗，請確認 Channel ID 與 Channel Secret",
  403: "此 LINE 官方帳號沒有推播權限",
  429: "已達 LINE 訊息額度或頻率上限",
};

/** Pushes alerts through a LINE official account (Messaging API). */
function createLineNotifier(getDelivery, request = fetch) {
  // Stateless tokens last 15 minutes; reuse one until shortly before then.
  let cached = null;

  async function call(url, options) {
    try {
      return await request(url, {
        ...options,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error("無法連線至 LINE，請檢查網路");
    }
  }

  async function accessToken({ channelId, secret }) {
    if (
      cached?.channelId === channelId &&
      cached.secret === secret &&
      cached.expiresAt > Date.now()
    )
      return cached.token;
    cached = null;
    const response = await call(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: channelId,
        client_secret: secret,
      }).toString(),
    });
    if (response.status === 400 || response.status === 401)
      throw new Error("LINE 登入失敗，請確認 Channel ID 與 Channel Secret");
    if (!response.ok) throw new Error(`LINE 登入失敗（${response.status}）`);
    const result = await response.json();
    if (typeof result?.access_token !== "string")
      throw new Error("LINE 登入回應格式不正確");
    cached = {
      channelId,
      secret,
      token: result.access_token,
      expiresAt: Date.now() + (Number(result.expires_in || 0) - 60) * 1000,
    };
    return cached.token;
  }

  async function push(token, to, text) {
    const response = await call(PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Line-Retry-Key": randomUUID(),
      },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
    });
    if (response.ok) return;
    if (response.status === 401) cached = null;
    throw new Error(
      PUSH_ERRORS[response.status] ?? `LINE 發送失敗（${response.status}）`,
    );
  }

  return async function notifyLine(token, body, test = false) {
    try {
      const delivery = getDelivery(token, test);
      if (!test && !delivery.enabled)
        return { sent: false, message: "LINE 通知已關閉" };
      const text =
        `【${delivery.title}】${test ? "LINE 通知測試" : "異常警報"}\n` +
        String(body || "偵測到新的異常，請查看儀錶板。");
      const access = await accessToken(delivery);
      const results = await Promise.allSettled(
        delivery.recipients.map((to) =>
          push(access, to, text.slice(0, MAX_TEXT_LENGTH)),
        ),
      );
      const failed = results.filter((item) => item.status === "rejected");
      if (failed.length) {
        const reasons = [...new Set(failed.map((item) => item.reason.message))];
        return {
          sent: false,
          message: `${failed.length}／${results.length} 個對象發送失敗：${reasons.join("；")}`,
        };
      }
      return { sent: true, message: `已送出至 ${results.length} 個 LINE 對象` };
    } catch (error) {
      return {
        sent: false,
        message: error instanceof Error ? error.message : "LINE 發送失敗",
      };
    }
  };
}
module.exports = { createLineNotifier };
