// Read-only view of plugin text (for example a translation), in place of the editor.
// The text is not in the store and cannot be edited. "Show original" hides the overlay (it stays as a cache).

import { Columns2, RefreshCw } from "lucide-react";
import { useSession, useSessionState } from "../app/sessionContext";
import { usePlugins } from "./pluginsContext";
import { pluginIcon } from "./PluginMenu";
import type { Overlay } from "./overlay";
import type { Id } from "../../core/types";
import "./plugins.css";

export function TransformedChip({ itemId, overlay }: { itemId: Id; overlay: Overlay }) {
  const plugins = usePlugins();
  const session = useSession();
  const { settings } = useSessionState();
  const plugin = plugins.plugins.find((entry) => entry.name === overlay.plugin);
  const Icon = pluginIcon(plugin?.details?.icon);
  // The original changed after the plugin made the result (for example, the user typed in the side-by-side view).
  const outdated =
    (overlay.bodySource !== null && overlay.bodySource !== (session.store.get("texts", itemId)?.body ?? "")) ||
    (overlay.titleSource !== null && overlay.titleSource !== session.store.get("items", itemId)?.name);
  const side = settings.transformLayout === "side";
  return (
    <span className="transformed-chips">
      <button className="transformed-chip" data-tip="Show the original text" onClick={() => plugins.showOriginal([itemId])}>
        <Icon size={12} options={plugin === undefined ? undefined : plugins.optionsOf(plugin.name)} />
        <span>{plugin?.details?.title ?? overlay.plugin}</span>
        <span className="muted">· {"Show original"}</span>
      </button>
      {outdated && (
        <button
          className="transformed-chip warn"
          data-tip="The text changed after this result. Click to make it again."
          disabled={plugins.job !== null}
          onClick={() => void plugins.transform(overlay.plugin, [itemId])}
        >
          <RefreshCw size={12} />
          <span>Outdated</span>
        </button>
      )}
      <button
        className={`icon-button small${side ? " active" : ""}`}
        data-tip={side ? "Show the result in place of the text" : "Show the result side by side with the text"}
        onClick={() => void session.updateSettings({ transformLayout: side ? "replace" : "side" })}
      >
        <Columns2 size={14} />
      </button>
    </span>
  );
}

/** A chip for an item whose cached result is hidden: one click shows it again. */
export function HiddenTransformChip({ itemId, overlay }: { itemId: Id; overlay: Overlay }) {
  const plugins = usePlugins();
  const plugin = plugins.plugins.find((entry) => entry.name === overlay.plugin);
  const Icon = pluginIcon(plugin?.details?.icon);
  return (
    <button className="transformed-chip quiet" data-tip="Show the result again" onClick={() => plugins.showTransformed([itemId])}>
      <Icon size={12} options={plugin === undefined ? undefined : plugins.optionsOf(plugin.name)} />
      <span>{plugin?.details?.title === "Translate" ? "Show translation" : "Show result"}</span>
    </button>
  );
}

/** The body of an overlay. If the plugin did not change the body, `original` shows. */
export function TransformedText({ overlay, original }: { overlay: Overlay; original: string }) {
  return (
    <div className="transformed-text" dir="auto">
      {overlay.body ?? original}
    </div>
  );
}
