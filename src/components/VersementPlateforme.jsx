/**
 * VersementPlateforme.jsx
 * 
 * Formulaire : enregistrement d'un reversement App Store / Google Play pour
 * les abonnements Wheeloh (in-app purchase).
 * Un seul enregistrement par relevé mensuel de reversement (pas de fiche
 * client individuelle par abonné).
 *
 * Écritures (via garde-fou) :
 *   Débit 512 Banque (net)
 *   Débit 6226 Commissions plateformes (commission)
 *   Crédit 706 Prestations de services (brut)
 *
 * Compte 706 utilisé par défaut (prestations)  à ajuster si nécessaire en
 * saisie manuelle pour distinguer 706 (services) de 707 (ventes de produits).
 */
import { useState } from 'react';
import {
    collection, addDoc, serverTimestamp,
    doc, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant } from '../services/helpers';
import { Tooltip } from './Shared';
import { FileUpload } from './FileUpload';

const PLATEFORMES = ['App Store (Apple)', 'Google Play Store'];

export function VersementPlateforme({ onCreated }) {
    const [plateforme, setPlateforme] = useState('App Store (Apple)');
    const [moisPeriode, setMoisPeriode] = useState(
        new Date().toISOString().slice(0, 7) // "YYYY-MM"
    );
    const [montantBrut, setMontantBrut] = useState('');
    const [commission, setCommission] = useState('');
    const [dateVersement, setDateVersement] = useState(new Date().toISOString().split('T')[0]);
    const [documentIds, setDocumentIds] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    const brut = parseFloat(montantBrut) || 0;
    const comm = parseFloat(commission) || 0;
    const net = +(brut - comm).toFixed(2);
    const tauxComm = brut > 0 ? +((comm / brut) * 100).toFixed(1) : 0;

    async function handleSubmit(e) {
        e.preventDefault();
        setError(''); setSaving(true);

        try {
            if (!brut) { setError('Le montant brut est obligatoire.'); setSaving(false); return; }
            if (net < 0) { setError('La commission ne peut pas dépasser le montant brut.'); setSaving(false); return; }

            const mouvements = [
                { compte: '512', libelle: `Banque  ${plateforme}`, debit: net, credit: 0 },
                { compte: '6226', libelle: `Commission ${plateforme}`, debit: comm, credit: 0 },
                { compte: '706', libelle: `Abonnements Wheeloh  ${plateforme}`, debit: 0, credit: brut },
            ].filter((m) => m.debit > 0 || m.credit > 0);

            const { ecritureId } = await ecrireEcriture({
                journal: 'BQ',
                date: dateVersement,
                libelle: `Reversement ${plateforme}  ${moisPeriode}`,
                sourceType: 'versement_plateforme',
                mouvements,
            });

            const versRef = await addDoc(collection(db, 'versementsPlateformes'), {
                plateforme,
                moisPeriode,        // ex. "2026-09"
                montantBrut: brut,
                commission: comm,
                montantNet: net,
                tauxCommission: tauxComm,
                dateVersement: new Date(dateVersement),
                ecritureIds: [ecritureId],
                documentIds,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            for (const dId of documentIds) {
                await updateDoc(doc(db, 'documents', dId), { sourceId: versRef.id, sourceType: 'versement_plateforme' });
            }

            setDone(true);
            onCreated?.({ versementId: versRef.id });
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    function reset() {
        setDone(false); setError(''); setMontantBrut(''); setCommission(''); setDocumentIds([]);
    }

    if (done) return (
        <div className="notice notice--success">
             Reversement {plateforme} enregistré  Net : <strong>{formatMontant(net)}</strong>
            <button className="btn btn--sm btn--ghost" style={{ marginLeft: 12 }} onClick={reset}>
                Nouveau reversement
            </button>
        </div>
    );

    return (
        <form onSubmit={handleSubmit}>
            <div className="page-header">
                <h1>Reversement App Store / Play Store</h1>
                <p>Enregistrement des reversements mensuels pour les abonnements Wheeloh.</p>
            </div>

            {error && <div className="notice notice--danger">{error}</div>}

            {/*  Plateforme  */}
            <div className="card">
                <div className="card__title"> Plateforme</div>
                <div style={{ display: 'flex', gap: 10 }}>
                    {PLATEFORMES.map((p) => (
                        <button
                            key={p} type="button"
                            className={`btn ${plateforme === p ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setPlateforme(p)}
                        >
                            {p === 'App Store (Apple)' ? '' : ''} {p}
                        </button>
                    ))}
                </div>
            </div>

            {/*  Période & Date  */}
            <div className="card">
                <div className="card__title"> Période & versement</div>
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Mois concerné</label>
                        <input
                            type="month" className="form-input"
                            value={moisPeriode}
                            onChange={(e) => setMoisPeriode(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Date du versement reçu</label>
                        <input
                            type="date" className="form-input"
                            value={dateVersement}
                            onChange={(e) => setDateVersement(e.target.value)}
                            required
                        />
                    </div>
                </div>
            </div>

            {/*  Montants  */}
            <div className="card">
                <div className="card__title">
                     Montants
                    <Tooltip text="Saisissez les chiffres depuis votre relevé App Store Connect ou Google Play Console. Le taux de commission varie (15% pour les abonnements renouvelés depuis plus d'un an, 30% sinon  Apple) ou selon le programme Play Store." />
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Montant brut encaissé par la plateforme ()</label>
                        <input
                            type="number" min="0" step="0.01" className="form-input" required
                            value={montantBrut}
                            onChange={(e) => setMontantBrut(e.target.value)}
                            placeholder="Ex. 100.00"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Commission prélevée ()</label>
                        <input
                            type="number" min="0" step="0.01" className="form-input"
                            value={commission}
                            onChange={(e) => setCommission(e.target.value)}
                            placeholder="Ex. 15.00"
                        />
                        {brut > 0 && comm > 0 && (
                            <p className="form-hint">Taux effectif : {tauxComm}%</p>
                        )}
                    </div>
                </div>

                {/* Récap */}
                <div style={{ marginTop: 8, padding: '12px 16px', background: 'var(--bg3)', borderRadius: 'var(--radius)', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 14 }}>
                    <span>Brut plateforme : <strong>{formatMontant(brut)}</strong></span>
                    <span>Commission {plateforme.split(' ')[0]} : <strong style={{ color: 'var(--danger)' }}> {formatMontant(comm)}</strong></span>
                    <span>Net reçu : <strong style={{ color: net >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: 16 }}>{formatMontant(net)}</strong></span>
                </div>
            </div>

            {/*  Aperçu écritures  */}
            <div className="card" style={{ borderColor: 'var(--border-focus)' }}>
                <div className="card__title"> Écritures qui seront générées</div>
                <div className="table-wrap">
                    <table>
                        <thead><tr><th>Compte</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Débit</th><th style={{ textAlign: 'right' }}>Crédit</th></tr></thead>
                        <tbody>
                            {[
                                { compte: '512', libelle: `Banque  ${plateforme}`, debit: net, credit: 0 },
                                { compte: '6226', libelle: `Commission ${plateforme}`, debit: comm, credit: 0 },
                                { compte: '706', libelle: `Abonnements Wheeloh`, debit: 0, credit: brut },
                            ].filter((m) => m.debit > 0 || m.credit > 0).map((m, i) => (
                                <tr key={i}>
                                    <td><code>{m.compte}</code></td>
                                    <td style={{ fontSize: 13 }}>{m.libelle}</td>
                                    <td style={{ textAlign: 'right' }}>{m.debit ? formatMontant(m.debit) : ''}</td>
                                    <td style={{ textAlign: 'right' }}>{m.credit ? formatMontant(m.credit) : ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/*  Relevé  */}
            <div className="card">
                <div className="card__title"> Relevé de reversement</div>
                <FileUpload
                    sourceType="versement_plateforme"
                    sourceId={null}
                    onUploaded={({ documentId }) => setDocumentIds((p) => [...p, documentId])}
                />
                <p className="form-hint" style={{ marginTop: 8 }}>PDF issu d'App Store Connect ou Google Play Console.</p>
            </div>

            <button type="submit" className="btn btn--primary" disabled={saving || !brut} style={{ minWidth: 200 }}>
                {saving ? 'Enregistrement' : ' Enregistrer le reversement'}
            </button>
        </form>
    );
}
