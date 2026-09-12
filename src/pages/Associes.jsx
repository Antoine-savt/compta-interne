/**
 * Associes.jsx — Panel liste des associés + CRUD
 * Solde compte courant calculé en temps réel depuis avancesFrags et ccaMouvements
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    collection, query, orderBy, getDocs,
    addDoc, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { formatMontant } from '../services/helpers';

const ROLES = [
    { value: 'president', label: 'Président' },
    { value: 'associe', label: 'Associé' },
    { value: 'president_associe', label: 'Président & Associé' },
];

const FORM_VIDE = {
    nom: '',
    prenom: '',
    role: 'associe',
    pourcentageParts: '',
    tauxInteretCCA: '',
    actif: true,
};

export default function Associes() {
    const navigate = useNavigate();
    const [associes, setAssocies] = useState([]);
    const [avances, setAvances] = useState([]);
    const [ccaMouvements, setCcaMouvements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState(null);
    const [form, setForm] = useState(FORM_VIDE);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        const [assSnap, avSnap, ccaSnap] = await Promise.all([
            getDocs(query(collection(db, 'associes'), orderBy('createdAt'))),
            getDocs(collection(db, 'avancesFrags')),
            getDocs(collection(db, 'ccaMouvements')),
        ]);
        setAssocies(assSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setAvances(avSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setCcaMouvements(ccaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    /** Solde compte courant global = (apports + avances non remboursées + intérêts - remboursements CCA) */
    function soldeCC(associeId) {
        // Avances de frais
        const soldeAvances = avances
            .filter((a) => a.associeId === associeId)
            .reduce((sum, a) => {
                if (a.statut === 'annule') return sum;
                if (a.statut === 'rembourse') return sum;
                return sum + (a.montant ?? 0);
            }, 0);

        // Mouvements CCA
        const mvts = ccaMouvements.filter((m) => m.associeId === associeId);
        const apports = mvts.filter((m) => m.type === 'apport').reduce((s, m) => s + (m.montant || 0), 0);
        const interets = mvts.filter((m) => m.type === 'interets').reduce((s, m) => s + (m.montant || 0), 0);
        const remb = mvts.filter((m) => m.type === 'remboursement').reduce((s, m) => s + (m.montant || 0), 0);

        return +(apports + soldeAvances + interets - remb).toFixed(2);
    }

    /** Attribue automatiquement le prochain sous-compte 455x */
    function prochainCompteCC() {
        const indices = associes.map((a) => parseInt(a.compteCC ?? '4550')).filter(Boolean);
        const max = indices.length ? Math.max(...indices) : 4550;
        return String(max + 1);
    }

    function openNew() {
        setEditId(null);
        setForm(FORM_VIDE);
        setError('');
        setShowForm(true);
    }

    function openEdit(a) {
        setEditId(a.id);
        setForm({
            nom: a.nom,
            prenom: a.prenom ?? '',
            role: a.role,
            pourcentageParts: a.pourcentageParts ?? '',
            tauxInteretCCA: a.tauxInteretCCA ?? '',
        });
        setError('');
        setShowForm(true);
    }

    async function handleSave() {
        if (!form.nom.trim()) { setError('Le nom est obligatoire.'); return; }
        const pct = parseFloat(form.pourcentageParts);
        if (isNaN(pct) || pct < 0 || pct > 100) { setError('Le % de parts doit être entre 0 et 100.'); return; }
        const tauxCCA = form.tauxInteretCCA !== '' ? parseFloat(form.tauxInteretCCA) : null;
        if (tauxCCA !== null && (isNaN(tauxCCA) || tauxCCA < 0)) { setError('Le taux d\'intérêt doit être un nombre positif.'); return; }

        setSaving(true); setError('');

        if (editId) {
            await updateDoc(doc(db, 'associes', editId), {
                nom: form.nom.trim(),
                prenom: form.prenom.trim(),
                role: form.role,
                pourcentageParts: pct,
                tauxInteretCCA: tauxCCA,
                updatedAt: serverTimestamp(),
            });
        } else {
            await addDoc(collection(db, 'associes'), {
                nom: form.nom.trim(),
                prenom: form.prenom.trim(),
                role: form.role,
                pourcentageParts: pct,
                tauxInteretCCA: tauxCCA,
                compteCC: prochainCompteCC(),
                actif: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        }
        setSaving(false); setShowForm(false);
        load();
    }

    async function toggleActif(a) {
        const msg = a.actif
            ? `Retirer ${a.nom} des associés actifs ? Ses données comptables sont conservées. Cette action ne remplace pas les formalités légales réelles (cession de parts, modification des statuts).`
            : `Réactiver ${a.nom} ?`;
        if (!window.confirm(msg)) return;
        await updateDoc(doc(db, 'associes', a.id), { actif: !a.actif, updatedAt: serverTimestamp() });
        load();
    }

    const totalParts = associes.filter((a) => a.actif).reduce((s, a) => s + (a.pourcentageParts ?? 0), 0);

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Associés</h1>
                    <p>Gestion des membres et de leurs comptes courants</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--ghost" onClick={() => navigate('/associes/cca')}>
                        Comptes Courants (CCA)
                    </button>
                    <button className="btn btn--primary" onClick={openNew}>
                        Ajouter un associé
                    </button>
                </div>
            </div>

            {/* Avertissement légal */}
            <div className="notice notice--info" style={{ marginBottom: 20 }}>
                Cet écran est un outil de suivi comptable interne. Retirer un associé ici ne remplace pas les formalités légales obligatoires (cession de parts, modification des statuts, enregistrement au greffe).
            </div>

            {/* Formulaire inline */}
            {showForm && (
                <div className="card" style={{ borderColor: 'var(--accent)' }}>
                    <div className="card__title">{editId ? 'Modifier l\'associé' : 'Nouvel associé'}</div>
                    {error && <div className="notice notice--danger">{error}</div>}
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Nom</label>
                            <input type="text" className="form-input" value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} autoFocus />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Prénom</label>
                            <input type="text" className="form-input" value={form.prenom} onChange={(e) => setForm((f) => ({ ...f, prenom: e.target.value }))} />
                        </div>
                    </div>
                    <div className="form-row--3">
                        <div className="form-group">
                            <label className="form-label">Rôle</label>
                            <select className="form-select" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Parts détenues (%)</label>
                            <input type="number" min="0" max="100" step="0.01" className="form-input" value={form.pourcentageParts} onChange={(e) => setForm((f) => ({ ...f, pourcentageParts: e.target.value }))} placeholder="Ex. 60" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Taux d'intérêt CCA conventionnel (%)</label>
                            <input type="number" min="0" step="0.01" className="form-input" value={form.tauxInteretCCA} onChange={(e) => setForm((f) => ({ ...f, tauxInteretCCA: e.target.value }))} placeholder="Ex. 5.00" />
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn--primary" disabled={saving} onClick={handleSave}>{saving ? 'Enregistrement...' : editId ? 'Enregistrer' : 'Créer'}</button>
                        <button className="btn btn--ghost" onClick={() => setShowForm(false)}>Annuler</button>
                    </div>
                </div>
            )}

            {loading && <p style={{ color: 'var(--text-muted)' }}>Chargement...</p>}

            {/* Liste */}
            {!loading && (
                <>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Associé</th>
                                        <th>Rôle</th>
                                        <th style={{ textAlign: 'right' }}>Parts</th>
                                        <th>Compte CC</th>
                                        <th style={{ textAlign: 'center' }}>Taux CCA</th>
                                        <th style={{ textAlign: 'right' }}>Solde CC global</th>
                                        <th>Statut</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {associes.length === 0 && (
                                        <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Aucun associé enregistré.</td></tr>
                                    )}
                                    {associes.map((a) => {
                                        const solde = soldeCC(a.id);
                                        return (
                                            <tr key={a.id} style={{ opacity: a.actif ? 1 : 0.5 }}>
                                                <td>
                                                    <div style={{ fontWeight: 500 }}>{a.nom} {a.prenom}</div>
                                                </td>
                                                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                                    {ROLES.find((r) => r.value === a.role)?.label ?? a.role}
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    {a.pourcentageParts != null ? `${a.pourcentageParts} %` : '—'}
                                                </td>
                                                <td><code>{a.compteCC || '455'}</code></td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {a.tauxInteretCCA != null ? (
                                                        <span className="badge badge--info">{a.tauxInteretCCA} %</span>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 600, color: solde > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                                                    {solde > 0 ? formatMontant(solde) : '—'}
                                                    {solde > 0 && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>dû par la société</div>}
                                                </td>
                                                <td>
                                                    <span className={`badge ${a.actif ? 'badge--success' : 'badge--muted'}`}>
                                                        {a.actif ? 'Actif' : 'Retiré'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: 6 }}>
                                                        <button className="btn btn--sm btn--ghost" onClick={() => navigate(`/associes/${a.id}`)}>Fiche</button>
                                                        <button className="btn btn--sm btn--ghost" onClick={() => openEdit(a)}>Modifier</button>
                                                        <button className="btn btn--sm btn--danger" onClick={() => toggleActif(a)}>{a.actif ? 'Retirer' : 'Réactiver'}</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                {associes.length > 0 && (
                                    <tfoot>
                                        <tr>
                                            <td colSpan={2}><strong>Total parts actifs</strong></td>
                                            <td style={{ textAlign: 'right', fontWeight: 700 }}>
                                                <span style={{ color: Math.abs(totalParts - 100) < 0.01 ? 'var(--success)' : 'var(--danger)' }}>
                                                    {totalParts} %
                                                </span>
                                            </td>
                                            <td colSpan={5}></td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </div>
                    {Math.abs(totalParts - 100) > 0.01 && associes.some((a) => a.actif) && (
                        <div className="notice notice--warning">
                            Le total des parts ({totalParts} %) ne fait pas 100 %. Vérifiez la répartition.
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
