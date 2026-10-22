import { afterEach, describe, expect, it } from "vitest";
import { setUiLanguage, t, translate } from "../src/ui/i18n/i18n";
import zh from "../src/ui/i18n/zh.json";
import zhHant from "../src/ui/i18n/zh-Hant.json";
import { readSettings } from "../src/io/settings";

describe("UI language", () => {
  afterEach(() => setUiLanguage("en"));

  it("shows English source text without a pack", () => {
    expect(t("Create note")).toBe("Create note");
    expect(t("Undo {0} (⌘Z)", "Rename")).toBe("Undo Rename (⌘Z)");
  });

  it("translates exact text, text with places, and keeps the space around it", () => {
    setUiLanguage("zh-Hant");
    expect(t("Create note")).toBe("新建便簽");
    expect(translate("  Settings ")).toBe("  設置 ");
    expect(t("Undo {0} (⌘Z)", "Rename")).toBe("撤銷「重命名」（⌘Z）");
    // Text from the screen: the places are found again. A UI word in a "{t0}" place is translated too.
    expect(translate("Undo Rename (⌘Z)")).toBe("撤銷「重命名」（⌘Z）");
    expect(translate("October 2026")).toBe("2026年10月");
    // User text in a "{0}" place stays as it is.
    expect(translate("Link “Board” to…")).toBe("把「Board」連接到…");
    expect(translate("Text that is not in the pack")).toBe("Text that is not in the pack");
    // A value made of UI words, in a "{t0}" place: also translated (a listen time).
    expect(translate("about 5 min to listen at 1.00×")).toBe("以 1.00× 語速聽完需約 5 分鐘");
  });

  it("uses the words of the user's terms in both Chinese packs", () => {
    setUiLanguage("zh-Hant");
    expect([t("Board"), t("Page"), t("Flashcard"), t("URL"), t("Link"), t("Color"), t("Your name")]).toEqual(["畫板", "文檔", "單詞卡", "鏈接", "連接兩個結點", "調色板", "用戶暱稱"]);
    setUiLanguage("zh");
    expect([t("Board"), t("Page"), t("Flashcard"), t("URL"), t("Link"), t("Color"), t("Your name")]).toEqual(["画板", "文档", "单词卡", "链接", "连接两个结点", "调色板", "用户昵称"]);
    expect(t("Action items: all open ones")).toBe("查看所有待办事项");
  });

  it("each pack text has the places of its key", () => {
    for (const [key, text] of [...Object.entries(zh as Record<string, string>), ...Object.entries(zhHant as Record<string, string>)]) {
      const places = (value: string) => [...value.matchAll(/\{t?(\d)\}/g)].map((match) => match[1]).sort().join();
      expect(places(text), key).toBe(places(key));
    }
  });

  it("the setting keeps a language code and ignores other values", () => {
    expect(readSettings(undefined).uiLanguage).toBe("en");
    expect(readSettings('{"uiLanguage":"zh"}').uiLanguage).toBe("zh");
    expect(readSettings('{"uiLanguage":"zh-Hant"}').uiLanguage).toBe("zh-Hant");
    expect(readSettings('{"uiLanguage":"<script>"}').uiLanguage).toBe("en");
    expect(readSettings(undefined).theme).toBe("dark");
    expect(readSettings('{"theme":"light"}').theme).toBe("light");
    expect(readSettings('{"theme":"blue"}').theme).toBe("dark");
    expect(readSettings(undefined).uiFontWeight).toBe(400);
    expect(readSettings('{"uiFontWeight":550}').uiFontWeight).toBe(550);
    expect(readSettings('{"uiFontWeight":2000}').uiFontWeight).toBe(400);
    expect(readSettings(undefined).pageWidth).toBe(760);
    expect(readSettings('{"pageWidth":1000}').pageWidth).toBe(1000);
    expect(readSettings('{"pageWidth":50}').pageWidth).toBe(760);
  });
});
