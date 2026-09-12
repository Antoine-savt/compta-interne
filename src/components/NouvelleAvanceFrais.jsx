/**
 * NouvelleAvanceFrais.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Formulaire : avance de frais faite par un associé ou le président pour la société.
 *
 * Écritures à l'avance (via garde-fou) :
 *   Débit compte de charge (selon catégorie) / Crédit 455x (compte courant associé)
 *
 * Si "Déjà remboursé" est coché, génère immédiatement aussi :
 *   Débit 455x / Crédit 512
 *
 * Sinon, le remboursement se fait depuis la Fiche Associé.
 */
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
    collection, getDocs, query, orderBy,
    addDoc, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant } from '../services/helpers';
import { FileUpload } from './FileUpload';
import { Tooltip } from './Shared';

export function NouvelleAvanceFrais({ onCreated }) {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [associes, setAssocies] = useState([]);
    const [categories, setCategories] = useState([]);
    const [associeId, setAssocieId] = useState(searchParams.get('associeId') ?? '');
    const [categorieId, setCategorieId] = useState('');
    const [description, setDescription] = useState('');
    const [montant, setMontant] = useState('');
    const [dateAvance, setDateAvance] = useState(new Date().toISOString().split('T')[0]);
    const [dejaRembourse, setDejaRembourse] = useState(false);
    const [documentIds, setDocumentIds] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);

    useEffect(() => {
        Promise.all([
            getDocs(query(collection(db, 'associes'), orderBy('nom'))),
            getDocs(query(collection(db, 'categoriesDepense'), orderBy('ordre'))),
        ]).then(([assSnap, catSnap]) => {
            setAssocies(assSnap.docs.filter((d) => d.data().actif).map((d) => ({ id: d.id, ...d.data() })));
            setCategories(catSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
    }, []);

    const associe = associes.find((a) => a.id === associeId);
    const categorie = categories.find((c) => c.id === categorieId);
    const montantNum = parseFloat(montant) || 0;

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        if (!associeId) { setError('Sélectionnez un associé.'); return; }
        if (!categorieId) { setError('Sélectionnez une catégorie de dépense.'); return; }
        if (!montantNum) { setError('Le montant est obligatoire.'); return; }
        if (!description.trim()) { setError('La description est obligatoire.'); return; }
        setSaving(true);

        try {
            const compteCharge = categorie.compte;
            const compteCC = associe.compteCC;

            // Écriture 1 : avance (charge / compte courant associé)
            const { ecritureId: ecritureAvanceId } = await ecrireEcriture({
                journal: 'OD',
                date: dateAvance,
                libelle: `Avance frais ${associe.nom} — ${description}`,
                sourceType: 'avance_frais',
                mouvements: [
                    { compte: compteCharge, libelle: `${categorie.label} — ${description}`, debit: montantNum, credit: 0 },
                    { compte: compteCC, libelle: `Compte courant ${associe.nom}`, debit: 0, credit: montantNum },
                ],
            });

            let ecritureVersementId = null;
            const today = new Date().toISOString().split('T')[0];

            // Écriture 2 (optionnelle) : remboursement immédiat
            if (dejaRembourse) {
                const res = await ecrireEcriture({
                    journal: 'BQ',
                    date: today,
                    libelle: `Remboursement avance frais ${associe.nom} — ${description}`,
                    sourceType: 'avance_frais',
                    mouvements: [
                        { compte: compteCC, libelle: `Compte courant ${associe.nom}`, debit: montantNum, credit: 0 },
                        { compte: '512', libelle: 'Banque', debit: 0, credit: montantNum },
                    ],
                });
                ecritureVersementId = res.ecritureId;
            }

            const ref = await addDoc(collection(db, 'avancesFrags'), {
                associeId,
                associeNom: `${associe.nom} ${associe.prenom}`.trim(),
                description: description.trim(),
                categorieId,
                categorieLabel: categorie.label,
                compteCharge,
                montant: montantNum,
                dateAvance: new Date(dateAvance),
                statut: dejaRembourse ? 'rembourse' : 'a_rembourser',
                dateRemboursement: dejaRembourse ? new Date(today) : null,
                ecritureAvanceId,
                ecritureVersementId,
                documentIds,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            // Lier les documents
            for (const dId of documentIds) {
                await updateDoc(doc(db, 'documents', dId), { sourceId: ref.id, sourceType: 'avance_frais' }).catch(() => { });
            }

            setDone({ associeId, associeNom: associe.nom, montant: montantNum, dejaRembourse });
            onCreated?.({ avanceId: ref.id });
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    if (done) return (
        <div>
            <div className="notice notice--success">
                Avance de {formatMontant(done.montant)} enregistrée pour {done.associeNom}.
                {done.dejaRembourse
                    ? ' Remboursement immédiat enregistré (457 → 512).'
                    : ' Le remboursement se fait depuis la fiche associé.'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn--ghost" onClick={() => navigate(`/associes/${done.associeId}`)}>Voir la fiche</button>
                <button className="btn btn--primary" onClick={() => { setDone(null); setMontant(''); setDescription(''); setDocumentIds([]); }}>
                    Nouvelle avance
                </button>
            </div>
        </div>
    );

    const mouvementsPreview = associe && categorie && montantNum > 0 ? [
        { compte: categorie.compte, libelle: `${categorie.label} — ${description || '...'}`, debit: montantNum, credit: 0 },
        { compte: associe.compteCC, libelle: `Compte courant ${associe.nom}`, debit: 0, credit: montantNum },
        ...(dejaRembourse ? [
            { compte: associe.compteCC, libelle: `Compte courant ${associe.nom}`, debit: montantNum, credit: 0 },
            { compte: '512', libelle: 'Banque', debit: 0, credit: montantNum },
        ] : []),
    ] : [];

    return (
        <form onSubmit={handleSubmit}>
            <div className="page-header">
                <div>
                    <h1>Avance de frais</h1>
                    <p>Dépense personnelle avancée pour le compte de la société</p>
                </div>
            </div>

            {error && <div className="notice notice--danger">{error}</div>}

            <div className="card">
                <div className="card__title">Associé</div>
                <div className="form-group">
                    <label className="form-label">Qui a avancé ?</label>
                    <select className="form-select" value={associeId} onChange={(e) => setAssocieId(e.target.value)} required>
                        <option value="">Sélectionner...</option>
                        {associes.map((a) => <option key={a.id} value={a.id}>{a.nom} {a.prenom} — Compte {a.compteCC}</option>)}
                    </select>
                </div>
            </div>

            <div className="card">
                <div className="card__title">Dépense</div>
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">
                            Catégorie de dépense
                            <Tooltip text="Réutilise les mêmes catégories que le module Dépenses. Le compte de charge est attribué automatiquement par catégorie." />
                        </label>
                        <select className="form-select" value={categorieId} onChange={(e) => setCategorieId(e.target.value)} required>
                            <option value="">Sélectionner...</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.label} — {c.compte}</option>)}
                        </select>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Montant avancé (€)</label>
                        <input type="number" min="0.01" step="0.01" className="form-input" value={montant} onChange={(e) => setMontant(e.target.value)} required placeholder="Ex. 85.00" />
                    </div>
                </div>
                <div className="form-group">
                    <label className="form-label">Description</label>
                    <input type="text" className="form-input" value={description} onChange={(e) => setDescription(e.target.value)} required placeholder="Ex. Repas client du 12/09, Achat câble HDMI..." />
                </div>
                <div className="form-group">
                    <label className="form-label">Date de l'avance</label>
                    <input type="date" className="form-input" style={{ maxWidth: 200 }} value={dateAvance} onChange={(e) => setDateAvance(e.target.value)} required />
                </div>

                {/* Toggle remboursement immédiat */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)', marginTop: 8 }}>
                    <input
                        type="checkbox" id="deja-rembourse" checked={dejaRembourse}
                        onChange={(e) => setDejaRembourse(e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <label htmlFor="deja-rembourse" style={{ fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
                        Déjà remboursé(e) — générer aussi l'écriture de remboursement bancaire maintenant
                    </label>
                </div>
            </div>

            <div className="card">
                <div className="card__title">Justificatif</div>
                <FileUpload
                    sourceType="avance_frais"
                    sourceId={null}
                    onUploaded={({ documentId }) => setDocumentIds((p) => [...p, documentId])}
                />
            </div>

            {/* Aperçu écritures */}
            {montantNum > 0 && associe && categorie && (
                <div className="card" style={{ borderColor: '#2563eb' }}>
                    <div className="card__title">Ecritures qui seront générées</div>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr><th>Compte</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Débit</th><th style={{ textAlign: 'right' }}>Crédit</th></tr>
                            </thead>
                            <tbody>
                                {/* Écriture avance — toujours */}
                                <tr>
                                    <td><code>{categorie.compte}</code></td>
                                    <td style={{ fontSize: 12 }}>{categorie.label} — {description || '...'}</td>
                                    <td style={{ textAlign: 'right' }}>{formatMontant(montantNum)}</td>
                                    <td style={{ textAlign: 'right' }}>—</td>
                                </tr>
                                <tr>
                                    <td><code>{associe.compteCC}</code></td>
                                    <td style={{ fontSize: 12 }}>Compte courant {associe.nom}</td>
                                    <td style={{ textAlign: 'right' }}>—</td>
                                    <td style={{ textAlign: 'right' }}>{formatMontant(montantNum)}</td>
                                </tr>
                                {/* Écriture remboursement immédiat — si cochée */}
                                {dejaRembourse && <>
                                    <tr>
                                        <td colSpan={4} style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 12px', background: 'var(--bg2)', borderTop: '2px dashed var(--border)' }}>
                                            Remboursement immédiat
                                        </td>
                                    </tr>
                                    <tr>
                                        <td><code>{associe.compteCC}</code></td>
                                        <td style={{ fontSize: 12 }}>Compte courant {associe.nom}</td>
                                        <td style={{ textAlign: 'right' }}>{formatMontant(montantNum)}</td>
                                        <td style={{ textAlign: 'right' }}>—</td>
                                    </tr>
                                    <tr>
                                        <td><code>512</code></td>
                                        <td style={{ fontSize: 12 }}>Banque</td>
                                        <td style={{ textAlign: 'right' }}>—</td>
                                        <td style={{ textAlign: 'right' }}>{formatMontant(montantNum)}</td>
                                    </tr>
                                </>}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <button type="submit" className="btn btn--primary" disabled={saving || !montantNum || !associeId || !categorieId} style={{ minWidth: 200 }}>
                {saving ? 'Enregistrement...' : 'Enregistrer l\'avance'}
            </button>
        </form>
    );
}
