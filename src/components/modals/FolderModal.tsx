import { useState, type FormEvent } from 'react';
import { passVaultApi, type ApiFolder } from '../../api/passVaultApi';
import { ModalShell } from '../ui/ModalShell';

export function FolderModal({ folder, onClose, onSaved }: { folder?: ApiFolder; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(folder?.name ?? '');
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (folder) await passVaultApi.renameFolder(folder.id, name);
      else await passVaultApi.createFolder(name);
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Folder save failed');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <ModalShell title={folder ? 'Rename Folder' : 'New Folder'} onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={handleSubmit} disabled={submitting || !name}>{submitting ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form className="modal-form" onSubmit={handleSubmit}>
        <label>Folder name <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
      </form>
    </ModalShell>
  );
}
