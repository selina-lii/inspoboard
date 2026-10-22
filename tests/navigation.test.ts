import { describe, expect, it } from "vitest";
import { historyGo, historyStep, type History } from "../src/ui/app/navigation";

describe("view history", () => {
  it("keeps a snapshot of each view: back and forward give it again; a jump is a step also on the same board", () => {
    let history: History<string> = { entries: [{ view: { path: ["root"], mode: "2d" } }], index: 0, arrived: null };
    // A jump on the same board: a new step (forced). Not forced: no step.
    expect(historyGo(history, (view) => view, "same").index).toBe(0);
    history = historyGo(history, (view) => view, "before jump", true);
    expect(history.index).toBe(1);
    history = historyGo(history, (view) => ({ ...view, path: ["root", "board"] }), "on jump target");
    history = historyStep(history, -1, "in board");
    expect(history.arrived).toEqual({ snapshot: "on jump target" });
    history = historyStep(history, -1, "on jump target again");
    expect(history.arrived).toEqual({ snapshot: "before jump" });
    history = historyStep(history, 1, "before jump");
    expect(history.arrived).toEqual({ snapshot: "on jump target again" });
    // A new view drops the views after this one.
    history = historyGo(history, (view) => ({ ...view, path: ["root", "other"] }), "left");
    expect(history.entries.map((entry) => entry.view.path.at(-1))).toEqual(["root", "root", "other"]);
    expect(historyStep(history, 1, "x").index).toBe(history.index);
  });
});
