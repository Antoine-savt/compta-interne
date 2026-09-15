/**
 * ModalManageCustomColumns.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Modale épurée et moderne pour gérer les colonnes de statuts
 * - Supprimer facilement N'IMPORTE QUELLE colonne (y compris les colonnes de base)
 * - Créer une nouvelle colonne en quelques clics
 * - Modifier les options et couleurs d'une colonne existante
 * 
 * Contrainte stricte : AUCUN EMOJI. Design soigné et haute lisibilité.
 */
import { useState } from 'react';
import { COLOR_PALETTE, saveCustomColumns } from '../../services/crmCustomColumnsService';

export default function ModalManageCustomColumns({ columns = [], onClose, onSave }) {
    const [cols, setCols] = useState(() => JSON.parse(JSON.stringify(columns)));
    const [editingColId, setEditingColId] = useState(null); // id de la colonne en cours de modification
    const [isCreating, setIsCreating] = useState(columns.length === 0);
    const [newColTitle, setNewColTitle] = useState('');
    const [newColOptions, setNewColOptions] = useState([
        { id: 'opt_1', label: 'En attente', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
        { id: 'opt_2', label: 'En cours', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
        { id: 'opt_3', label: 'Validé', color: '#047857', bg: '#d1fae5', border: '#6ee7b7' },
    ]);
    const [newOptLabel, setNewOptLabel] = useState('');
    const [newOptColor, setNewOptColor] = useState(COLOR_PALETTE[1]);
    const [saving, setSaving] = useState(false);

    // Supprimer définitivement une colonne
    async function handleDeleteColumn(colId, colLabel) {
        if (!window.confirm(`Supprimer définitivement la colonne "${colLabel}" ?`)) return;
        const updated = cols.filter((c) => c.id !== colId);
        setCols(updated);
        if (editingColId === colId) setEditingColId(null);
        try {
            await saveCustomColumns(updated);
            onSave(updated);
        } catch (err) {
            console.error('Erreur suppression colonne:', err);
        }
    }

    // Créer une nouvelle colonne
    async function handleCreateColumn(e) {
        e.preventDefault();
        const title = newColTitle.trim();
        if (!title) return;

        const newCol = {
            id: 'col_' + Date.now(),
            label: title,
            type: 'select',
            options: newColOptions.filter((o) => o.label.trim()),
        };

        const updated = [...cols, newCol];
        setCols(updated);
        setNewColTitle('');
        setIsCreating(false);

        try {
            await saveCustomColumns(updated);
            onSave(updated);
        } catch (err) {
            console.error('Erreur création colonne:', err);
        }
    }

    // Mettre à jour la colonne en cours d'édition
    async function handleSaveEditedCol(updatedCol) {
        const updated = cols.map((c) => (c.id === updatedCol.id ? updatedCol : c));
        setCols(updated);
        setEditingColId(null);

        try {
            await saveCustomColumns(updated);
            onSave(updated);
        } catch (err) {
            console.error('Erreur mise à jour colonne:', err);
        }
    }

    const currentEditingCol = cols.find((c) => c.id === editingColId);

    return (
        <div
            className="modal-overlay"
            onClick={onClose}
            style={{
                zIndex: 1000,
                background: 'rgba(15, 23, 42, 0.65)',
                backdropFilter: 'blur(3px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <div
                className="modal"
                style={{
                    maxWidth: 580,
                    width: '94%',
                    background: '#ffffff',
                    borderRadius: 10,
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 0,
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ─── Entête ─── */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#ffffff' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                            Colonnes de statuts
                        </h3>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                            Créez, modifiez ou supprimez vos colonnes de sélection.
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

                {/* ─── Onglets de navigation dans la modale ─── */}
                <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', padding: '0 20px' }}>
                    <button
                        type="button"
                        onClick={() => { setIsCreating(false); setEditingColId(null); }}
                        style={{
                            padding: '10px 14px',
                            border: 'none',
                            background: 'transparent',
                            borderBottom: !isCreating && !editingColId ? '2px solid var(--accent)' : '2px solid transparent',
                            color: !isCreating && !editingColId ? 'var(--accent)' : '#64748b',
                            fontWeight: 600,
                            fontSize: 13,
                            cursor: 'pointer',
                        }}
                    >
                        Colonnes existantes ({cols.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => { setIsCreating(true); setEditingColId(null); }}
                        style={{
                            padding: '10px 14px',
                            border: 'none',
                            background: 'transparent',
                            borderBottom: isCreating ? '2px solid var(--accent)' : '2px solid transparent',
                            color: isCreating ? 'var(--accent)' : '#64748b',
                            fontWeight: 600,
                            fontSize: 13,
                            cursor: 'pointer',
                        }}
                    >
                        + Créer une colonne
                    </button>
                </div>

                {/* ─── Corps ─── */}
                <div style={{ padding: 20, maxHeight: '60vh', overflowY: 'auto' }}>
                    {/* VUE 1 : Liste des colonnes existantes */}
                    {!isCreating && !editingColId && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {cols.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '32px 16px', color: '#94a3b8' }}>
                                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>Aucune colonne personnalisée.</p>
                                    <button
                                        type="button"
                                        className="btn btn--primary btn--sm"
                                        onClick={() => setIsCreating(true)}
                                        style={{ marginTop: 12 }}
                                    >
                                        + Créer votre première colonne
                                    </button>
                                </div>
                            ) : (
                                cols.map((col) => (
                                    <div
                                        key={col.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '10px 14px',
                                            background: '#f8fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: 8,
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                                                {col.label}
                                            </div>
                                            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                                {(col.options || []).map((opt) => (
                                                    <span
                                                        key={opt.id}
                                                        style={{
                                                            fontSize: 10,
                                                            fontWeight: 600,
                                                            padding: '1px 6px',
                                                            borderRadius: 4,
                                                            background: opt.bg || '#f1f5f9',
                                                            color: opt.color || '#475569',
                                                            border: `1px solid ${opt.border || '#e2e8f0'}`,
                                                        }}
                                                    >
                                                        {opt.label}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <button
                                                type="button"
                                                className="btn btn--ghost btn--sm"
                                                onClick={() => setEditingColId(col.id)}
                                                style={{ fontSize: 11, padding: '4px 10px' }}
                                            >
                                                Modifier
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn--danger-ghost btn--sm"
                                                onClick={() => handleDeleteColumn(col.id, col.label)}
                                                style={{ fontSize: 11, padding: '4px 10px', color: '#ef4444' }}
                                                title="Supprimer définitivement"
                                            >
                                                Supprimer
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {/* VUE 2 : Création d'une nouvelle colonne */}
                    {isCreating && (
                        <form onSubmit={handleCreateColumn} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div>
                                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                                    Nom de la colonne *
                                </label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Ex: Statut site web, Priorité, Avancement..."
                                    required
                                    value={newColTitle}
                                    onChange={(e) => setNewColTitle(e.target.value)}
                                    style={{ fontSize: 13, height: 34 }}
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                                    Options du menu déroulant ({newColOptions.length})
                                </label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {newColOptions.map((opt, idx) => (
                                        <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: opt.color, flexShrink: 0 }} />
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={opt.label}
                                                onChange={(e) => {
                                                    const updated = [...newColOptions];
                                                    updated[idx].label = e.target.value;
                                                    setNewColOptions(updated);
                                                }}
                                                style={{ flex: 1, height: 30, fontSize: 12, padding: '2px 8px' }}
                                            />
                                            <select
                                                value={opt.color}
                                                onChange={(e) => {
                                                    const pal = COLOR_PALETTE.find((p) => p.color === e.target.value) || COLOR_PALETTE[0];
                                                    const updated = [...newColOptions];
                                                    updated[idx].color = pal.color;
                                                    updated[idx].bg = pal.bg;
                                                    updated[idx].border = pal.border;
                                                    setNewColOptions(updated);
                                                }}
                                                style={{ height: 30, fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #cbd5e1' }}
                                            >
                                                {COLOR_PALETTE.map((p) => (
                                                    <option key={p.id} value={p.color}>{p.label}</option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => setNewColOptions(newColOptions.filter((_, i) => i !== idx))}
                                                style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                                                title="Supprimer cette option"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                {/* Ajouter une option */}
                                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Nouvelle option (ex: Bloqué)..."
                                        value={newOptLabel}
                                        onChange={(e) => setNewOptLabel(e.target.value)}
                                        style={{ flex: 1, height: 30, fontSize: 12 }}
                                    />
                                    <select
                                        value={newOptColor.id}
                                        onChange={(e) => setNewOptColor(COLOR_PALETTE.find((p) => p.id === e.target.value) || COLOR_PALETTE[0])}
                                        style={{ height: 30, fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #cbd5e1' }}
                                    >
                                        {COLOR_PALETTE.map((p) => (
                                            <option key={p.id} value={p.id}>{p.label}</option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        className="btn btn--secondary btn--sm"
                                        onClick={() => {
                                            if (!newOptLabel.trim()) return;
                                            setNewColOptions([
                                                ...newColOptions,
                                                {
                                                    id: 'opt_' + Date.now(),
                                                    label: newOptLabel.trim(),
                                                    color: newOptColor.color,
                                                    bg: newOptColor.bg,
                                                    border: newOptColor.border,
                                                },
                                            ]);
                                            setNewOptLabel('');
                                        }}
                                        style={{ height: 30, fontSize: 11 }}
                                    >
                                        + Ajouter
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                                <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    onClick={() => setIsCreating(false)}
                                >
                                    Annuler
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn--primary btn--sm"
                                >
                                    Créer la colonne
                                </button>
                            </div>
                        </form>
                    )}

                    {/* VUE 3 : Modification d'une colonne existante */}
                    {editingColId && currentEditingCol && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div>
                                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                                    Nom de la colonne
                                </label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={currentEditingCol.label}
                                    onChange={(e) => {
                                        const updated = { ...currentEditingCol, label: e.target.value };
                                        setCols(cols.map((c) => (c.id === currentEditingCol.id ? updated : c)));
                                    }}
                                    style={{ fontSize: 13, height: 34 }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                                    Options ({currentEditingCol.options?.length || 0})
                                </label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {(currentEditingCol.options || []).map((opt, idx) => (
                                        <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: opt.color, flexShrink: 0 }} />
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={opt.label}
                                                onChange={(e) => {
                                                    const opts = [...currentEditingCol.options];
                                                    opts[idx] = { ...opts[idx], label: e.target.value };
                                                    const updated = { ...currentEditingCol, options: opts };
                                                    setCols(cols.map((c) => (c.id === currentEditingCol.id ? updated : c)));
                                                }}
                                                style={{ flex: 1, height: 30, fontSize: 12, padding: '2px 8px' }}
                                            />
                                            <select
                                                value={opt.color}
                                                onChange={(e) => {
                                                    const pal = COLOR_PALETTE.find((p) => p.color === e.target.value) || COLOR_PALETTE[0];
                                                    const opts = [...currentEditingCol.options];
                                                    opts[idx] = { ...opts[idx], color: pal.color, bg: pal.bg, border: pal.border };
                                                    const updated = { ...currentEditingCol, options: opts };
                                                    setCols(cols.map((c) => (c.id === currentEditingCol.id ? updated : c)));
                                                }}
                                                style={{ height: 30, fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #cbd5e1' }}
                                            >
                                                {COLOR_PALETTE.map((p) => (
                                                    <option key={p.id} value={p.color}>{p.label}</option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const opts = currentEditingCol.options.filter((_, i) => i !== idx);
                                                    const updated = { ...currentEditingCol, options: opts };
                                                    setCols(cols.map((c) => (c.id === currentEditingCol.id ? updated : c)));
                                                }}
                                                style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                                                title="Supprimer cette option"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                {/* Ajouter une option */}
                                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ajouter une option..."
                                        value={newOptLabel}
                                        onChange={(e) => setNewOptLabel(e.target.value)}
                                        style={{ flex: 1, height: 30, fontSize: 12 }}
                                    />
                                    <select
                                        value={newOptColor.id}
                                        onChange={(e) => setNewOptColor(COLOR_PALETTE.find((p) => p.id === e.target.value) || COLOR_PALETTE[0])}
                                        style={{ height: 30, fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #cbd5e1' }}
                                    >
                                        {COLOR_PALETTE.map((p) => (
                                            <option key={p.id} value={p.id}>{p.label}</option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        className="btn btn--secondary btn--sm"
                                        onClick={() => {
                                            if (!newOptLabel.trim()) return;
                                            const opts = [
                                                ...(currentEditingCol.options || []),
                                                {
                                                    id: 'opt_' + Date.now(),
                                                    label: newOptLabel.trim(),
                                                    color: newOptColor.color,
                                                    bg: newOptColor.bg,
                                                    border: newOptColor.border,
                                                },
                                            ];
                                            const updated = { ...currentEditingCol, options: opts };
                                            setCols(cols.map((c) => (c.id === currentEditingCol.id ? updated : c)));
                                            setNewOptLabel('');
                                        }}
                                        style={{ height: 30, fontSize: 11 }}
                                    >
                                        + Ajouter
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                                <button
                                    type="button"
                                    className="btn btn--danger-ghost btn--sm"
                                    onClick={() => handleDeleteColumn(currentEditingCol.id, currentEditingCol.label)}
                                    style={{ color: '#ef4444' }}
                                >
                                    Supprimer la colonne
                                </button>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        type="button"
                                        className="btn btn--ghost btn--sm"
                                        onClick={() => setEditingColId(null)}
                                    >
                                        Retour
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn--primary btn--sm"
                                        onClick={() => handleSaveEditedCol(currentEditingCol)}
                                    >
                                        Enregistrer
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* ─── Footer ─── */}
                <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    );
}
