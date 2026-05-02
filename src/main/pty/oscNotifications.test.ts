import { describe, expect, it } from "vitest";
import { extractOscNotifications, parseOscPayload } from "./oscNotifications";

describe("parseOscPayload", () => {
  it("OSC 9 单字段消息：title 默认 '终端通知'，body=payload", () => {
    expect(parseOscPayload(9, "build finished")).toEqual({
      title: "终端通知",
      body: "build finished"
    });
  });

  it("OSC 99 含 id= 前缀时剥离", () => {
    expect(parseOscPayload(99, "id=42;deploy ok")).toEqual({
      title: "终端通知",
      body: "deploy ok"
    });
  });

  it("OSC 99 无 id= 前缀时整段作 body", () => {
    expect(parseOscPayload(99, "deploy ok")).toEqual({
      title: "终端通知",
      body: "deploy ok"
    });
  });

  it("OSC 777 notify;title;body 解析三段", () => {
    expect(parseOscPayload(777, "notify;CI;all green")).toEqual({
      title: "CI",
      body: "all green"
    });
  });

  it("OSC 777 body 含分号原样保留", () => {
    expect(parseOscPayload(777, "notify;CI;a;b;c")).toEqual({
      title: "CI",
      body: "a;b;c"
    });
  });

  it("OSC 777 非 notify 前缀降级到默认 title", () => {
    expect(parseOscPayload(777, "alert;something")).toEqual({
      title: "终端通知",
      body: "alert;something"
    });
  });

  it("OSC 777 title 为空字符串时回退到默认", () => {
    expect(parseOscPayload(777, "notify;;body only")).toEqual({
      title: "终端通知",
      body: "body only"
    });
  });
});

describe("extractOscNotifications", () => {
  it("无 OSC 序列时 cleaned=data，notifications 空", () => {
    const result = extractOscNotifications("s1", "hello world\n");
    expect(result.cleaned).toBe("hello world\n");
    expect(result.notifications).toEqual([]);
  });

  it("OSC 9 BEL 终止符：剥离序列、产生通知", () => {
    const data = "before\x1b]9;build done\x07after";
    const result = extractOscNotifications("s1", data);
    expect(result.cleaned).toBe("beforeafter");
    expect(result.notifications).toEqual([
      { surfaceId: "s1", code: 9, title: "终端通知", body: "build done" }
    ]);
  });

  it("OSC 777 ESC \\ 终止符同样工作", () => {
    const data = "x\x1b]777;notify;CI;ok\x1b\\y";
    const result = extractOscNotifications("s1", data);
    expect(result.cleaned).toBe("xy");
    expect(result.notifications).toEqual([
      { surfaceId: "s1", code: 777, title: "CI", body: "ok" }
    ]);
  });

  it("一段数据多个 OSC：按出现顺序聚合", () => {
    const data = "\x1b]9;a\x07mid\x1b]99;id=1;b\x07tail";
    const result = extractOscNotifications("s2", data);
    expect(result.cleaned).toBe("midtail");
    expect(result.notifications).toHaveLength(2);
    expect(result.notifications[0]).toMatchObject({ code: 9, body: "a" });
    expect(result.notifications[1]).toMatchObject({ code: 99, body: "b" });
  });

  it("连续两次调用结果一致：模块级 /g 正则状态被复位", () => {
    const data = "\x1b]9;ping\x07";
    const first = extractOscNotifications("s1", data);
    const second = extractOscNotifications("s1", data);
    expect(first).toEqual(second);
  });

  it("不识别 OSC 0/8 之类，原样保留", () => {
    const data = "\x1b]0;tab title\x07kept";
    const result = extractOscNotifications("s1", data);
    // 0 不在 9/99/777 中：通过 cleaned 中保留原序列断言
    expect(result.cleaned).toContain("\x1b]0;tab title\x07");
    expect(result.notifications).toEqual([]);
  });
});
