import { useState } from 'react';
import { Edit3, FolderPlus, Plus, Trash2, X } from 'lucide-react';
import type { ApiFolder, ApiTag } from '../../api/passVaultApi';

export function FoldersPanel({
  folders, tags, onCreate, onRename, onDelete, onCreateTag, onDeleteTag,
}: {
  folders: ApiFolder[];
  tags: ApiTag[];
  onCreate: () => void;
  onRename: (folder: ApiFolder) => void;
  onDelete: (folder: ApiFolder) => void;
  onCreateTag: (name: string) => Promise<void>;
  onDeleteTag: (tag: ApiTag) => Promise<void>;
}) {
  const [newTag, setNewTag] = useState('');
  return (
    <section className="panel-grid">
      <article className="panel-card">
        <div className="panel-toolbar">
          <div><p className="eyebrow">Organization</p><h3>Folders</h3></div>
          <button className="primary-button" onClick={onCreate}><FolderPlus size={16} /> New Folder</button>
        </div>
        <div className="table-card">
          <div className="table-row table-head folder-row"><span>Folder</span><span>Items</span><span>Created</span><span></span></div>
          {folders.map((folder) => (
            <div className="table-row folder-row" key={folder.id}>
              <span><strong>{folder.name}</strong></span>
              <span>{folder.itemCount}</span>
              <span>{new Date(folder.createdAt).toLocaleDateString()}</span>
              <span className="action-cluster">
                <button className="mini-button" onClick={() => onRename(folder)}><Edit3 size={14} /> Rename</button>
                <button className="danger-button" onClick={() => onDelete(folder)}><Trash2 size={14} /> Delete</button>
              </span>
            </div>
          ))}
          {folders.length === 0 && <p className="muted" style={{ padding: '1rem' }}>No folders yet. Create one to organize items.</p>}
        </div>
      </article>

      <article className="panel-card">
        <div className="panel-toolbar">
          <div><p className="eyebrow">Tagging</p><h3>Tags</h3></div>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!newTag.trim()) return;
            await onCreateTag(newTag.trim());
            setNewTag('');
          }}
          style={{ display: 'flex', gap: '0.6rem', margin: '0.6rem 0' }}
        >
          <input className="text-input" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag (e.g. infra, payroll)" />
          <button className="primary-button"><Plus size={14} /> Add</button>
        </form>
        <div className="chip-grid">
          {tags.map((tag) => (
            <span className="chip" key={tag.id}>
              {tag.name}
              <button className="icon-button" onClick={() => onDeleteTag(tag)}><X size={12} /></button>
            </span>
          ))}
          {tags.length === 0 && <small className="muted">No tags yet.</small>}
        </div>
      </article>
    </section>
  );
}
