/**
 * Cloture.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Travaux de clôture de l'exercice.
 * Produits constatés d'avance (PCA, compte 487) : la part des abonnements facturés
 * qui couvre une période postérieure à la clôture est retirée du chiffre d'affaires
 * de l'exercice (D 706 / C 487) puis réintégrée le lendemain par extourne (D 487 / C 706).
 * Les écritures passées sont mémorisées dans `clotures/{dateFin}` et ne peuvent être
 * annulées que par contre-passation.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { ecrireEcriture, annulerEcriture } from '../../services/api';
import { invalidateEcrituresCache } from '../../services/comptaService';
import { formatMontant, formatDate } from '../../services/helpers';
import { DateInput } from '../../components/common/DateInput';
import { ValidationPeriode } from '../../components/ValidationPeriode';

const MOIS_PAR_RECURRENCE = { mensuel: 1, trimestriel: 3, annuel: 12 };

function ajouterMois(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1 + n, d));
    return date.toISOString().slice(0, 10);
}

function jours(debutIso, finIsoExclue) {
    return Math.round((Date.parse(finIsoExclue) - Date.parse(debutIso)) / 86400000);
}

function lendemainIso(iso) {
    return new Date(Date.parse(iso) + 86400000).toISOString().slice(0, 10);
}

function veilleIso(iso) {
    return new Date(Date.parse(iso) - 86400000).toISOString().slice(0, 10);
}

/**
 * Part d'un montant facturé pour la période [debut, finExclue[ qui tombe après la date de clôture (prorata des jours).
 */
export function calculerPCA(montant, debutIso, finIsoExclue, dateClotureIso) {
    const apres = lendemainIso(dateClotureIso);
    if (debutIso >= apres) return montant;
    if (finIsoExclue <= apres) return 0;
    return +(montant * jours(apres, finIsoExclue) / jours(debutIso, finIsoExclue)).toFixed(2);
}

export default function Cloture() {
    const anneeCourante = new Date().getFullYear();
    const [dateFin, setDateFin] = useState(`${anneeCourante}-12-31`);
    const [facturations, setFacturations] = useState([]);
    const [cloture, setCloture] = useState(null);
    const [manuelles, setManuelles] = useState([]);
    const [exclues, setExclues] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [facSnap, clotSnap] = await Promise.all([
                getDocs(collection(db, 'facturations')),
                getDoc(doc(db, 'clotures', dateFin)),
            ]);
            setFacturations(facSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setCloture(clotSnap.exists() ? clotSnap.data() : null);
        } catch (err) {
            setMessage({ type: 'danger', text: 'Chargement impossible : ' + err.message });
        } finally {
            setLoading(false);
        }
    }, [dateFin]);

    useEffect(() => { loadData(); }, [loadData]);

    // Lignes d'abonnement dont la période facturée chevauche la clôture
    const lignesAuto = useMemo(() => {
        const res = [];
        facturations.forEach((f) => {
            const dateFact = f.dateFacturation || '';
            if (!dateFact || dateFact > dateFin) return;
            (f.lignes || []).forEach((l, idx) => {
                const mois = MOIS_PAR_RECURRENCE[l.recurrence];
                if (!mois) return;
                const debut = l.dateDebut || dateFact;
                const fin = ajouterMois(debut, mois);
                const montant = +(l.total ?? (l.prixUnitaire || 0) * (l.quantite || 1)).toFixed(2);
                const pca = calculerPCA(montant, debut, fin, dateFin);
                if (pca <= 0) return;
                res.push({
                    key: `${f.id}-${idx}`,
                    client: f.clientNom || 'Client',
                    description: l.description,
                    montant,
                    debut,
                    fin,
                    pca,
                });
            });
        });
        return res.sort((a, b) => a.client.localeCompare(b.client));
    }, [facturations, dateFin]);

    const lignesManuelles = manuelles.map((m) => {
        const montant = parseFloat(m.montant) || 0;
        const ok = montant > 0 && m.debut && m.fin && m.fin > m.debut;
        return { ...m, montant, pca: ok ? calculerPCA(montant, m.debut, m.fin, dateFin) : 0 };
    });

    const lignesRetenues = [...lignesAuto.filter((l) => !exclues.has(l.key)), ...lignesManuelles.filter((l) => l.pca > 0)];
    const totalPCA = +lignesRetenues.reduce((s, l) => s + l.pca, 0).toFixed(2);
    const lendemain = lendemainIso(dateFin);

    async function comptabiliser() {
        if (!lignesRetenues.length) return;
        if (!window.confirm(`Passer ${formatMontant(totalPCA)} de produits constatés d'avance au ${formatDate(dateFin)}, avec extourne au ${formatDate(lendemain)} ?`)) return;
        setSaving(true);
        setMessage(null);
        const ecritureIds = [];
        try {
            const lignesCompta = lignesRetenues.map((l) => ({
                compte: '706',
                libelle: `PCA ${l.client} - ${l.description} (${formatDate(l.debut)} au ${formatDate(veilleIso(l.fin))})`,
                montant: l.pca,
            }));
            const { ecritureId } = await ecrireEcriture({
                journal: 'OD',
                date: dateFin,
                libelle: `Produits constatés d'avance au ${formatDate(dateFin)}`,
                pieceRef: `PCA-${dateFin.slice(0, 4)}`,
                sourceType: 'cloture_pca',
                mouvements: [
                    ...lignesCompta.map((l) => ({ compte: l.compte, libelle: l.libelle, debit: l.montant, credit: 0 })),
                    { compte: '487', libelle: "Produits constatés d'avance", debit: 0, credit: totalPCA },
                ],
            });
            ecritureIds.push(ecritureId);
            const { ecritureId: extourneId } = await ecrireEcriture({
                journal: 'OD',
                date: lendemain,
                libelle: `Extourne des produits constatés d'avance au ${formatDate(dateFin)}`,
                pieceRef: `PCA-${dateFin.slice(0, 4)}`,
                sourceType: 'cloture_pca',
                mouvements: [
                    { compte: '487', libelle: "Produits constatés d'avance", debit: totalPCA, credit: 0 },
                    ...lignesCompta.map((l) => ({ compte: l.compte, libelle: l.libelle, debit: 0, credit: l.montant })),
                ],
            });
            ecritureIds.push(extourneId);
            await setDoc(doc(db, 'clotures', dateFin), {
                dateFin,
                pca: {
                    total: totalPCA,
                    lignes: lignesRetenues.map(({ client, description, montant, debut, fin, pca }) => ({ client, description, montant, debut, fin, pca })),
                    ecritureId,
                    extourneId,
                    at: serverTimestamp(),
                },
            }, { merge: true });
            invalidateEcrituresCache();
            setMessage({ type: 'success', text: `Produits constatés d'avance comptabilisés : ${formatMontant(totalPCA)}.` });
            setManuelles([]);
            await loadData();
        } catch (err) {
            setMessage({
                type: 'danger',
                text: err.message + (ecritureIds.length ? ' Une écriture a déjà été passée : vérifiez le journal OD avant de réessayer.' : ''),
            });
        } finally {
            setSaving(false);
        }
    }

    async function annuler() {
        const pca = cloture?.pca;
        if (!pca) return;
        if (!window.confirm('Annuler les produits constatés d\'avance ? Les deux écritures seront retirées (ou contre-passées si la période est déjà validée).')) return;
        setSaving(true);
        try {
            for (const id of [pca.ecritureId, pca.extourneId].filter(Boolean)) {
                await annulerEcriture(id, 'Recalcul des produits constatés d\'avance');
            }
            await setDoc(doc(db, 'clotures', dateFin), { pca: null }, { merge: true });
            invalidateEcrituresCache();
            setMessage({ type: 'success', text: 'Écritures de PCA annulées. Vous pouvez recalculer.' });
            await loadData();
        } catch (err) {
            setMessage({ type: 'danger', text: err.message });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Clôture de l'exercice</h1>
                    <p>Validation des écritures et écritures d'inventaire</p>
                </div>
            </div>

            <ValidationPeriode />

            {message && <div className={`notice notice--${message.type}`}>{message.text}</div>}

            <div className="card" style={{ padding: '14px 20px' }}>
                <div className="form-group" style={{ maxWidth: 240, marginBottom: 0 }}>
                    <label className="form-label">Date de clôture de l'exercice</label>
                    <DateInput className="form-input" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
                </div>
            </div>

            <div className="card">
                <div className="card__title">Produits constatés d'avance (compte 487)</div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
                    Un abonnement facturé d'avance qui couvre une période après le {formatDate(dateFin)} ne fait pas partie du chiffre
                    d'affaires de l'exercice pour sa part future. Calcul au prorata des jours, à partir de la date de début de chaque ligne.
                </p>

                {loading ? (
                    <div style={{ padding: 20, color: 'var(--text-muted)' }}>Chargement...</div>
                ) : cloture?.pca ? (
                    <div>
                        <div className="notice notice--success">
                            Comptabilisés : <strong>{formatMontant(cloture.pca.total)}</strong> au {formatDate(dateFin)}, extournés au {formatDate(lendemain)}.
                        </div>
                        <TablePCA lignes={cloture.pca.lignes} />
                        <button className="btn btn--ghost" onClick={annuler} disabled={saving} style={{ marginTop: 12 }}>
                            Annuler et recalculer
                        </button>
                    </div>
                ) : (
                    <div>
                        {lignesAuto.length === 0 && (
                            <div className="notice notice--info">
                                Aucune ligne d'abonnement (mensuel, trimestriel, annuel) ne déborde sur l'exercice suivant.
                                Si une facture regroupe un abonnement dans une ligne « ponctuelle », modifiez-la (Journaux → Modifier) pour séparer
                                la ligne d'abonnement, ou ajoutez une ligne manuelle ci-dessous.
                            </div>
                        )}
                        {lignesAuto.length > 0 && (
                            <TablePCA
                                lignes={lignesAuto}
                                exclues={exclues}
                                onToggle={(key) => setExclues((prev) => {
                                    const next = new Set(prev);
                                    next.has(key) ? next.delete(key) : next.add(key);
                                    return next;
                                })}
                            />
                        )}

                        <div style={{ marginTop: 16 }}>
                            <div className="form-label" style={{ marginBottom: 6 }}>Lignes manuelles</div>
                            {manuelles.map((m, i) => (
                                <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px 140px 140px 32px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                                    <input className="form-input" placeholder="Client" value={m.client} onChange={(e) => setManuelles((p) => p.map((x, j) => j === i ? { ...x, client: e.target.value } : x))} />
                                    <input className="form-input" placeholder="Prestation" value={m.description} onChange={(e) => setManuelles((p) => p.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                                    <input className="form-input" type="number" step="0.01" placeholder="Montant" value={m.montant} onChange={(e) => setManuelles((p) => p.map((x, j) => j === i ? { ...x, montant: e.target.value } : x))} />
                                    <DateInput className="form-input" value={m.debut} onChange={(e) => setManuelles((p) => p.map((x, j) => j === i ? { ...x, debut: e.target.value } : x))} title="Début de la période facturée" />
                                    <DateInput className="form-input" value={m.fin} onChange={(e) => setManuelles((p) => p.map((x, j) => j === i ? { ...x, fin: e.target.value } : x))} title="Fin de la période facturée (exclue)" />
                                    <button type="button" className="btn btn--sm btn--ghost" style={{ color: 'var(--danger)' }} onClick={() => setManuelles((p) => p.filter((_, j) => j !== i))}>×</button>
                                </div>
                            ))}
                            <button
                                type="button"
                                className="btn btn--sm btn--ghost"
                                onClick={() => setManuelles((p) => [...p, { id: Date.now(), client: '', description: '', montant: '', debut: '', fin: '' }])}
                            >
                                + Ajouter une ligne manuelle
                            </button>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 13 }}>
                                Total à reporter : <strong style={{ fontSize: 16 }}>{formatMontant(totalPCA)}</strong>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    D 706 / C 487 au {formatDate(dateFin)} · extourne D 487 / C 706 au {formatDate(lendemain)}
                                </div>
                            </div>
                            <button className="btn btn--primary" onClick={comptabiliser} disabled={saving || totalPCA <= 0}>
                                {saving ? 'Enregistrement...' : 'Comptabiliser les PCA'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function TablePCA({ lignes, exclues, onToggle }) {
    return (
        <div className="table-wrap">
            <table>
                <thead>
                    <tr>
                        {onToggle && <th style={{ width: 32 }}></th>}
                        <th>Client</th>
                        <th>Prestation</th>
                        <th>Période facturée</th>
                        <th style={{ textAlign: 'right' }}>Facturé</th>
                        <th style={{ textAlign: 'right' }}>À reporter</th>
                    </tr>
                </thead>
                <tbody>
                    {lignes.map((l, i) => {
                        const exclue = exclues?.has(l.key);
                        return (
                            <tr key={l.key || i} style={{ opacity: exclue ? 0.45 : 1 }}>
                                {onToggle && (
                                    <td><input type="checkbox" checked={!exclue} onChange={() => onToggle(l.key)} /></td>
                                )}
                                <td>{l.client}</td>
                                <td>{l.description}</td>
                                <td style={{ fontSize: 12 }}>{formatDate(l.debut)} → {formatDate(veilleIso(l.fin))}</td>
                                <td style={{ textAlign: 'right' }}>{formatMontant(l.montant)}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatMontant(l.pca)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
