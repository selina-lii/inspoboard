// Plugins section of the settings dialog: the plugins folder, each plugin, and its actions.

import { ChevronDown, ChevronRight, FolderOpen, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { usePlugins } from "./pluginsContext";
import { pluginIcon } from "./PluginMenu";
import "./plugins.css";

export function PluginSettings() {
  const plugins = usePlugins();
  // The details of each plugin (description, actions) are folded by default. Errors and running tasks always show.
  const [open, setOpen] = useState(false);
  if (!plugins.available) return null;
  return (
    <div className="plugin-settings">
      <div className="plugin-settings-head">
        <span>Plugins</span>
        <span className="spacer" />
        <button className="icon-button small" data-tip={open ? "Hide plugin details" : "Show plugin details"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button className="icon-button small" data-tip="Read the plugins folder again" onClick={() => void plugins.reload()}>
          <RefreshCw size={14} />
        </button>
        <button className="icon-button small" data-tip="Select the plugins folder" data-tip-end onClick={() => void plugins.chooseFolder()}>
          <FolderOpen size={14} />
        </button>
      </div>
      <div className="setting-help plugin-folder" title={plugins.folder ?? undefined}>
        {plugins.folder ?? <span className="has-tip" data-tip="Plugins are optional programs that you install by hand.">No plugins folder</span>}
      </div>
      {plugins.plugins.length === 0 && plugins.folder !== null && <div className="setting-help">No plugins in this folder.</div>}
      {plugins.plugins.map((plugin) => {
        const Icon = pluginIcon(plugin.details?.icon);
        const job = plugins.job?.plugin === plugin.name ? plugins.job : null;
        return (
          <div key={plugin.name} className="plugin-entry">
            <div className="plugin-entry-head">
              <Icon size={14} options={plugins.optionsOf(plugin.name)} />
              <span>{plugin.details?.title ?? plugin.title}</span>
              <span className="muted">{plugin.version}</span>
            </div>
            {open && plugin.details?.description !== undefined && plugin.details.description !== "" && <div className="setting-help">{plugin.details.description}</div>}
            {plugin.error !== null && <div className="plugin-error">{plugin.error}</div>}
            {open && plugin.details?.actions.map((action) => (
              <div key={action.id} className="plugin-action">
                <span>
                  {action.label}
                  {action.detail !== "" && <span className="setting-help">{action.detail}</span>}
                </span>
                <button disabled={!action.enabled || plugins.job !== null} onClick={() => void plugins.runAction(plugin.name, action.id)}>
                  {job?.kind === "action" ? <LoaderCircle size={13} className="spin" /> : "Run"}
                </button>
              </div>
            ))}
            {job?.kind === "action" && (
              <div className="plugin-job">
                <progress max={Math.max(1, job.total)} value={job.done} />
                <span className="muted">{job.label}</span>
                <button className="icon-button small" data-tip="Cancel" onClick={plugins.cancel}>
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        );
      })}
      {plugins.error !== null && <div className="plugin-error">{plugins.error}</div>}
    </div>
  );
}
