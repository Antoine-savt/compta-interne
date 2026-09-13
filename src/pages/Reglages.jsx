/**
 * Reglages.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Réglages :
 * - Capital social initial & trésorerie de départ à la création de l'entreprise
 * - Statut TVA (franchise en base vs redevable)
 * - Codes journaux comptables
 * - Catégories de dépenses
 */
import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, serverTimestamp, getDocs, collection, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { invalidateSettingsCache, formatMontant, formatDate } from '../services/helpers';
import { invalidateEcrituresCache } from '../services/comptaService';
import { Tooltip } from '../components/Shared';

const TOOLTIP_FRANCHISE = `En franchise en base de TVA (article 293 B du CGI), vous n'êtes pas redevable de la TVA. Vous ne la facturez pas à vos clients et ne la récupérez pas sur vos achats. C'est le statut le plus simple pour les petites structures.`;
const TOOLTIP_CAPITAL = `Le capital social déposé à la création de la société (statuts / attestation de dépôt des fonds) constitue la trésorerie initiale de départ. Comptablement, il s'enregistre par un Débit du compte 512 (Banque) et un Crédit du compte 101 (Capital social).`;

export default function Reglages() {
    const [statutTVA, setStatutTVA] = useState('franchise');
    const [tauxTVA, setTauxTVA] = useState(20);
    const [journaux, setJournaux] = useState({ ventes: 'VE', achats: 'AC', banque: 'BQ', od: 'OD' });
    const [categories, setCategories] = useState([]);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // Trésorerie & Capital initial de création
    const [capitalInitial, setCapitalInitial] = useState('');
    const [dateCreation, setDateCreation] = useState('');
    const [banqueDepot, setBanqueDepot] = useState('Compte bancaire');
    const [ecritureCapitalInitialId, setEcritureCapitalInitialId] = useState(null);
    const [savingCapital, setSavingCapital] = useState(false);
    const [capitalSuccess, setCapitalSuccess] = useState('');
    const [capitalError, setCapitalError] = useState('');

    useEffect(() => {
        getDoc(doc(db, 'settings', 'config')).then((snap) => {
            if (snap.exists()) {
                const d = snap.data();
                setStatutTVA(d.statutTVA ?? 'franchise');
                setTauxTVA(d.tauxTVADefaut ?? 20);
                setJournaux(d.journaux ?? journaux);

                if (d.capitalInitial != null) setCapitalInitial(d.capitalInitial);
                if (d.dateCreation) setDateCreation(d.dateCreation);
                if (d.banqueDepot) setBanqueDepot(d.banqueDepot);
                if (d.ecritureCapitalInitialId) setEcritureCapitalInitialId(d.ecritureCapitalInitialId);
            }
        });

        getDocs(query(collection(db, 'categoriesDepense'), orderBy('ordre'))).then((s) =>
            setCategories(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
    }, []);

    // Enregistrement des paramètres généraux
    async function handleSaveGeneral() {
        setSaving(true);
        setSaved(false);
        await updateDoc(doc(db, 'settings', 'config'), {
            statutTVA,
            tauxTVADefaut: tauxTVA,
            journaux,
            updatedAt: serverTimestamp(),
        });
        invalidateSettingsCache();
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    }

    // Enregistrement et comptabilisation du capital initial de création
    async function handleSaveCapital(e) {
        e.preventDefault();
        const montantNum = parseFloat(capitalInitial);
        if (isNaN(montantNum) || montantNum <= 0) {
            setCapitalError('Veuillez saisir un montant de capital initial valide (> 0 €).');
            return;
        }
        if (!dateCreation) {
            setCapitalError('Veuillez sélectionner la date de création / dépôt des fonds.');
            return;
        }

        setSavingCapital(true);
        setCapitalError('');
        setCapitalSuccess('');

        try {
            let ecritureId = ecritureCapitalInitialId;

            if (ecritureId) {
                // Mise à jour de l'écriture existante pour préserver la cohérence des dates sans créer de doublon
                await updateDoc(doc(db, 'ecritures', ecritureId), {
                    date: new Date(dateCreation),
                    libelle: `Dépôt du capital social initial — ${banqueDepot.trim() || 'Banque'}`,
                    pieceRef: 'STATUTS',
                    mouvements: [
                        { compte: '512', libelle: `Banque — Dépôt capital initial (${banqueDepot})`, debit: montantNum, credit: 0 },
                        { compte: '101', libelle: `Capital social souscrit et libéré`, debit: 0, credit: montantNum },
                    ],
                    updatedAt: serverTimestamp(),
                });
            } else {
                // Création de l'écriture équilibrée (Débit 512 / Crédit 101)
                const res = await ecrireEcriture({
                    journal: 'BQ',
                    date: dateCreation,
                    libelle: `Dépôt du capital social initial — ${banqueDepot.trim() || 'Banque'}`,
                    sourceType: 'capital_initial',
                    pieceRef: 'STATUTS',
                    mouvements: [
                        { compte: '512', libelle: `Banque — Dépôt capital initial (${banqueDepot})`, debit: montantNum, credit: 0 },
                        { compte: '101', libelle: `Capital social souscrit et libéré`, debit: 0, credit: montantNum },
                    ],
                });
                ecritureId = res.ecritureId;
            }

            // Sauvegarde dans settings/config
            await updateDoc(doc(db, 'settings', 'config'), {
                capitalInitial: montantNum,
                dateCreation,
                banqueDepot: banqueDepot.trim(),
                ecritureCapitalInitialId: ecritureId,
                updatedAt: serverTimestamp(),
            });

            invalidateEcrituresCache();
            setEcritureCapitalInitialId(ecritureId);
            setCapitalSuccess(`Capital initial de ${formatMontant(montantNum)} enregistré et mis à jour à la date du ${formatDate(dateCreation)} (Écriture n° ${ecritureId.slice(0, 8)}). Le Grand Livre est recalculé avec cette date exacte.`);
        } catch (err) {
            setCapitalError(err.message || 'Erreur lors de la comptabilisation du capital.');
        } finally {
            setSavingCapital(false);
        }
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Réglages</h1>
                    <p>Paramètres comptables, trésorerie de départ et configuration de l'entreprise</p>
                </div>
            </div>

            {saved && <div className="notice notice--success">Réglages généraux enregistrés.</div>}

            {/* ─── 1. CAPITAL SOCIAL INITIAL & TRÉSORERIE DE DÉPART ─── */}
            <div className="card" style={{ borderColor: 'var(--border)', marginBottom: 24 }}>
                <div className="card__title" style={{ color: 'var(--text)' }}>
                    Trésorerie initiale & Capital social de création
                    <Tooltip text={TOOLTIP_CAPITAL} />
                </div>

                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                    Renseignez ici les fonds dont disposait la société lors de son immatriculation (capital social déposé à la banque). Cette écriture alimente automatiquement le compte bancaire <code>512</code> et le capital social <code>101</code> au passif du Bilan.
                </p>

                {capitalSuccess && <div className="notice notice--success">{capitalSuccess}</div>}
                {capitalError && <div className="notice notice--danger">{capitalError}</div>}

                <form onSubmit={handleSaveCapital}>
                    <div className="form-row--3">
                        <div className="form-group">
                            <label className="form-label">Montant du capital social / apport initial (€)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="1"
                                placeholder="Ex. 1000.00"
                                className="form-input"
                                value={capitalInitial}
                                onChange={(e) => setCapitalInitial(e.target.value)}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">
                                Date de dépôt / création
                                <Tooltip text="Date réelle figurant sur l'attestation de dépôt des fonds (Shine, Qonto...) ou des statuts. Cette date est répercutée dans le Grand Livre." />
                            </label>
                            <input
                                type="date"
                                className="form-input"
                                value={dateCreation}
                                onChange={(e) => setDateCreation(e.target.value)}
                                required
                            />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                Date réelle de l'attestation bancaire
                            </span>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Banque dépositaire</label>
                            <input
                                type="text"
                                placeholder="Ex. Qonto, Shine, BNP, etc."
                                className="form-input"
                                value={banqueDepot}
                                onChange={(e) => setBanqueDepot(e.target.value)}
                            />
                        </div>
                    </div>

                    {ecritureCapitalInitialId && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
                            Écriture comptable active liée : <code>{ecritureCapitalInitialId}</code> (Débit 512 / Crédit 101)
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn--primary"
                        disabled={savingCapital}
                    >
                        {savingCapital ? 'Comptabilisation en cours...' : ecritureCapitalInitialId ? 'Mettre à jour le capital initial' : 'Comptabiliser le capital initial'}
                    </button>
                </form>
            </div>

            {/* ─── 2. STATUT TVA ─── */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card__title">
                    Statut TVA de la société
                    <Tooltip text={TOOLTIP_FRANCHISE} />
                </div>

                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    {[
                        { value: 'franchise', label: 'Franchise en base (TVA non facturée / non récupérée)' },
                        { value: 'redevable', label: 'Assujetti et redevable de la TVA' },
                    ].map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            className={`btn ${statutTVA === opt.value ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setStatutTVA(opt.value)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>

                {statutTVA === 'franchise' && (
                    <div className="notice notice--info">
                        En franchise en base de TVA : les calculs de TVA sont désactivés par défaut dans tous vos formulaires.
                    </div>
                )}

                {statutTVA === 'redevable' && (
                    <div className="form-group">
                        <label className="form-label">Taux de TVA normal par défaut (%)</label>
                        <input
                            type="number"
                            className="form-input"
                            style={{ width: 120 }}
                            value={tauxTVA}
                            onChange={(e) => setTauxTVA(parseFloat(e.target.value) || 20)}
                        />
                    </div>
                )}
            </div>

            {/* ─── 3. CODES JOURNAUX ─── */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card__title">Codes journaux comptables</div>
                <div className="form-row">
                    {Object.entries({ ventes: 'Ventes', achats: 'Achats', banque: 'Banque', od: 'Opérations diverses' }).map(([k, label]) => (
                        <div key={k} className="form-group">
                            <label className="form-label">{label}</label>
                            <input
                                type="text"
                                className="form-input"
                                maxLength={4}
                                value={journaux[k] ?? ''}
                                onChange={(e) => setJournaux((j) => ({ ...j, [k]: e.target.value.toUpperCase() }))}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* ─── 4. CATÉGORIES DE DÉPENSES ─── */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card__title">Catégories de dépenses configurées</div>
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Catégorie</th>
                                <th>Compte PCG</th>
                                <th>Motif obligatoire</th>
                            </tr>
                        </thead>
                        <tbody>
                            {categories.map((c) => (
                                <tr key={c.id}>
                                    <td>{c.label}</td>
                                    <td><code>{c.compte}</code></td>
                                    <td>{c.motifObligatoire ? 'Oui' : 'Non'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <button className="btn btn--primary" disabled={saving} onClick={handleSaveGeneral} style={{ minWidth: 180 }}>
                {saving ? 'Enregistrement...' : 'Enregistrer les réglages généraux'}
            </button>
        </div>
    );
}
