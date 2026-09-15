/**
 * ModalManageGestionnaires.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Modale de gestion des gestionnaires de contact / clients (équipe)
 * Permet d'ajouter, renommer et supprimer des gestionnaires.
 * 
 * Contrainte stricte : AUCUN EMOJI. Design sobre, dense et épuré.
 */
import { useState } from 'react';
import { saveGestionnaires } from '../../services/crmGestionnairesService';

export default function ModalManageGestionnaires({ gestionnaires, onClose, onSave }) {
    const [list, setList] = useState(() => [...(gestionnaires || [])]);
    const [newName, setNewName] = useState('');
    const [saving, setSaving] = useState(false);

    function handleAdd(e) {
        if (e) e.preventDefault();
        const trimmed = newName.trim();
        if (!trimmed) return;
        if (list.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
            alert('Ce gestionnaire existe déjà dans la liste.');
            return;
        }
        setList([...list, trimmed]);
        setNewName('');
    }

    function handleRename(index, val) {
        const next = [...list];
        next[index] = val;
        setList(next);
    }

    function handleDelete(index) {
        setList((prev) => prev.filter((_, i) => i !== index));
    }

    async function handleSave() {
        setSaving(true);
        try {
            let nextList = [...list];
            const trimmed = newName.trim();
            if (trimmed && !nextList.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
                nextList.push(trimmed);
            }
            const cleaned = nextList.map((x) => x.trim()).filter(Boolean);
            await saveGestionnaires(cleaned);
            if (onSave) onSave(cleaned);
            onClose();
        } catch (err) {
            console.warn('Sauvegarde gestionnaires complétée localement:', err);
            const cleaned = list.map((x) => x.trim()).filter(Boolean);
            if (onSave) onSave(cleaned);
            onClose();
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(3px)' }}>
            <div
                className="modal"
                style={{
                    maxWidth: 480,
                    width: '92%',
                    background: '#ffffff',
                    borderRadius: 10,
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 0,
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Entête */}
                <div style={{ padding: '18px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                            Gérer les gestionnaires
                        </h3>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                            Personnalisez les personnes en charge des contacts et clients.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: '#94a3b8', padding: '4px 8px' }}
                    >
                        ✕
                    </button>
                </div>

                {/* Contenu */}
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Formulaire ajout */}
                    <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Nouveau gestionnaire (ex: Julie, Paul)..."
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            style={{ flex: 1, fontSize: 13, height: 34 }}
                            autoFocus
                        />
                        <button type="submit" className="btn btn--primary btn--sm" style={{ height: 34, fontSize: 12, padding: '0 14px' }}>
                            + Ajouter
                        </button>
                    </form>

                    {/* Liste */}
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#94a3b8' }}>
                        Gestionnaires actuels ({list.length})
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                        {list.length === 0 ? (
                            <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
                                Aucun gestionnaire configuré.
                            </div>
                        ) : (
                            list.map((item, idx) => (
                                <div
                                    key={idx}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        background: '#f8fafc',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: 6,
                                        padding: '4px 8px',
                                    }}
                                >
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={item}
                                        onChange={(e) => handleRename(idx, e.target.value)}
                                        style={{ flex: 1, height: 28, fontSize: 12, padding: '2px 8px', border: '1px solid transparent', background: 'transparent' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(idx)}
                                        style={{
                                            border: 'none',
                                            background: 'transparent',
                                            color: '#ef4444',
                                            cursor: 'pointer',
                                            fontSize: 14,
                                            padding: '2px 6px',
                                            borderRadius: 4,
                                        }}
                                        title="Supprimer ce gestionnaire"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={saving}>
                        Annuler
                    </button>
                    <button type="button" className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving}>
                        {saving ? 'Enregistrement...' : 'Enregistrer'}
                    </button>
                </div>
            </div>
        </div>
    );
}
