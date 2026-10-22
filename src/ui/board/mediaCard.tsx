// The card of a multimedia item (SPEC 7.14): the cover, the name, the artist, and the kind. A picture shows itself.
// - Double-click: the link opens in the web browser (no link: the fields open).
// - Buttons (on hover): edit the fields, open the link, get the title and the cover (with a "media-info" plugin).
// - No player: a player of a site loads from the network. The card shows only what is in the vault.

import { Clapperboard, Download, ExternalLink, Image as ImageIcon, Music, PenLine } from "lucide-react";
import { useState } from "react";
import { durationLabel, MEDIA_KIND_LABELS as KIND_LABELS, needsPicture, normalizeHost } from "../../core/media";
import { MEDIA_KINDS, type MediaInfo, type MediaKind } from "../../core/types";
import { useSession } from "../app/sessionContext";
import { useVaultImageUrl } from "../app/vaultImages";
import { useFieldForm } from "./fieldForm";
import { HiddenHandle, Resizer, useBoardCallbacks } from "./nodes";
import type { ObjectProps } from "./objectCards";

const KIND_ICONS = { image: ImageIcon, audio: Music, video: Clapperboard } as const;

export function MediaCard({ node, selected, editing, title, className, style }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const session = useSession();
  const media = node.media!;
  const picture = media.cover ?? (media.kind === "image" ? media.file : undefined) ?? null;
  const cover = useVaultImageUrl(session, picture);
  const Icon = KIND_ICONS[media.kind];
  if (editing === "title" || editing === "url") {
    return (
      <div className={`${className} media-card editing-media`}>
        <HiddenHandle />
        <MediaFields itemId={node.recordId} name={node.title} media={media} />
      </div>
    );
  }
  const named = title !== "" ? title : media.url !== undefined ? (normalizeHost(media.url) ?? "") : "";
  const canEdit = !callbacks.readOnly && editing === null;
  return (
    <div className={`${className} media-card`} style={style} data-tip={media.url}>
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      <div className="media-cover">
        {cover !== null ? <img src={cover} alt="" draggable={false} /> : <div className="media-placeholder" />}
        <span className="media-kind" data-tip={KIND_LABELS[media.kind]}>
          <Icon size={12} />
        </span>
        {media.duration !== undefined && <span className="media-duration">{durationLabel(media.duration)}</span>}
      </div>
      <div className="media-text">
        <span className={named === "" ? "card-name untitled" : "card-name"} dir="auto">
          {named === "" ? "Untitled media" : named}
        </span>
        {media.artist !== undefined && (
          <span className="card-name media-artist" dir="auto">
            {media.artist}
          </span>
        )}
      </div>
      <div className="media-buttons">
        {canEdit && (
          <button className="card-icon card-hover-only nodrag" data-tip="Edit the name, artist, link, and cover" onClick={(event) => (event.stopPropagation(), callbacks.onStartEdit(node.id, "title"))}>
            <PenLine size={12} />
          </button>
        )}
        {canEdit && media.url !== undefined && callbacks.onFetchMedia !== null && (
          <button className="card-icon card-hover-only nodrag" data-tip="Get title and cover (from the web, with the plugin)" onClick={(event) => (event.stopPropagation(), callbacks.onFetchMedia?.(node.recordId))}>
            <Download size={12} />
          </button>
        )}
        {media.url !== undefined && (
          <button className="card-icon card-hover-only nodrag" data-tip="Open in web browser" data-tip-end onClick={(event) => (event.stopPropagation(), callbacks.onOpenUrl(media.url!))}>
            <ExternalLink size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The fields of a media item in one form: name, artist, link, kind, cover. Enter saves; Escape cancels. If the form
 * goes away without Enter or Escape, it saves (as the link fields do).
 */
function MediaFields({ itemId, name: startName, media }: { itemId: string; name: string; media: MediaInfo }) {
  const callbacks = useBoardCallbacks();
  const [name, setName] = useState(startName);
  const [artist, setArtist] = useState(media.artist ?? "");
  const [url, setUrl] = useState(media.url ?? "");
  const [kind, setKind] = useState<MediaKind>(media.kind);
  const { finish, onKeyDown } = useFieldForm(() => {
    if (name.trim() !== startName) callbacks.onRename(itemId, name.trim());
    callbacks.onSetMedia(itemId, { ...media, kind, artist, url });
  }, callbacks.onEndEdit);
  return (
    <div className="link-fields media-fields nodrag nopan" onDoubleClick={(event) => event.stopPropagation()}>
      <label>
        <span>Name</span>
        <input className="card-title-input" autoFocus dir="auto" value={name} placeholder="Title" onChange={(event) => setName(event.target.value)} onKeyDown={onKeyDown} />
      </label>
      <label>
        <span>Artist</span>
        <input className="card-title-input" dir="auto" value={artist} placeholder="Artist (optional)" onChange={(event) => setArtist(event.target.value)} onKeyDown={onKeyDown} />
      </label>
      <label>
        <span>Link</span>
        <input className="card-title-input" data-file-drop value={url} spellCheck={false} placeholder="https://…" onChange={(event) => setUrl(event.target.value)} onKeyDown={onKeyDown} />
      </label>
      <label>
        <span>Kind</span>
        <select value={kind} onChange={(event) => setKind(event.target.value as MediaKind)}>
          {MEDIA_KINDS.map((value) => (
            <option key={value} value={value}>
              {KIND_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <div className="media-field-buttons">
        <button onClick={() => (finish(true), callbacks.onChooseCover(itemId))}>{needsPicture(media) ? "Choose picture…" : "Choose cover…"}</button>
        {media.cover !== undefined && <button onClick={() => (finish(false), callbacks.onSetMedia(itemId, { ...media, cover: undefined }))}>Remove cover</button>}
        <button onClick={() => (finish(false), callbacks.onSetMedia(itemId, null))}>Make it a note</button>
      </div>
      <div className="link-fields-hint">Enter saves · Esc cancels</div>
    </div>
  );
}
