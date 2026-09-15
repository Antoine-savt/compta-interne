/**
 * VersementStripe.jsx
 * 
 * Formulaire : enregistrement d'un versement Stripe reçu sur le compte bancaire.
 * Pas de compte 411 intermédiaire  Stripe a déjà encaissé pour le compte de
 * la société, on enregistre directement la recette nette à la date du virement.
 *
 * Écritures (via garde-fou) :
 *  Sans TVA : Débit 512 Banque (net) / Débit 6278 Frais Stripe / Crédit 706 (brut)
 *  Avec TVA : Débit 512 (net) / Débit 6278 (frais) / Crédit 706 (HT) / Crédit 4457 (TVA)
 */
import { useState, useEffect } from 'react';
import {
    collection, addDoc, serverTimestamp,
    getDocs, query, orderBy, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ecrireEcriture } from '../services/api';
import { formatMontant, formatDate, toISODate, getSettings, prochaineEcheance, doitEtreFixe } from '../services/helpers';
import { Tooltip, ToggleSwitch, SelecteurFrequence } from './Shared';
import { FileUpload } from './FileUpload';
import { DateInput } from './common/DateInput';

const TVA_TOOLTIP = `En franchise en base de TVA, vous ne collectez pas de TVA. Activez ce toggle uniquement si votre société est passée au régime réel assujetti à la TVA.`;

export function VersementStripe({ onCreated }) {
    const { user } = useAuth();

    const [clients, setClients] = useState([]);
    const [settings, setSettings] = useState({ statutTVA: 'franchise', tauxTVADefaut: 20 });

    // Champs formulaire
    const [clientId, setClientId] = useState('');
    const [clientNom, setClientNom] = useState('plusieurs / non détaillé');
    const [periodeDebut, setPeriodeDebut] = useState('');
    const [periodeFin, setPeriodeFin] = useState('');
    const [montantBrut, setMontantBrut] = useState('');
    const [fraisStripe, setFraisStripe] = useState('');
    const [dateVirement, setDateVirement] = useState(toISODate(new Date()));
    const [tvaOn, setTvaOn] = useState(false);
    const [tauxTVA, setTauxTVA] = useState(20);
    const [recurrence, setRecurrence] = useState({
        type: 'ponctuel', intervalleNombre: 1, intervalleUnite: 'mois', montantFixe: false, occurrencesPassees: 0,
    });
    const [documentIds, setDocumentIds] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    useEffect(() => {
        getDocs(query(collection(db, 'clients'), orderBy('nom'))).then((s) =>
            setClients(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
        getSettings().then((s) => {
            setSettings(s);
            setTvaOn(s.statutTVA === 'redevable');
            setTauxTVA(s.tauxTVADefaut ?? 20);
        });
    }, []);

    const brut = parseFloat(montantBrut) || 0;
    const frais = parseFloat(fraisStripe) || 0;
    const net = +(brut - frais).toFixed(2);

    // Calcul TVA sur le brut
    const tauxDecimal = tauxTVA / 100;
    const montantHT = tvaOn ? +(brut / (1 + tauxDecimal)).toFixed(2) : brut;
    const montantTVA = tvaOn ? +(brut - montantHT).toFixed(2) : 0;

    async function handleSubmit(e) {
        e.preventDefault();
        setError(''); setSaving(true);

        try {
            if (!brut) { setError('Le montant brut est obligatoire.'); setSaving(false); return; }
            if (net < 0) { setError('Le montant net ne peut pas être négatif.'); setSaving(false); return; }

            // Construction des mouvements selon statut TVA
            const mouvements = buildMouvements(net, frais, montantHT, montantTVA, tvaOn, clientNom);

            const { ecritureId } = await ecrireEcriture({
                journal: 'BQ',
                date: dateVirement,
                libelle: `Versement Stripe — ${clientNom}${periodeDebut ? ` (${formatDate(periodeDebut)}${periodeFin ? ' / ' + formatDate(periodeFin) : ''})` : ''}`,
                sourceType: 'versement_stripe',
                mouvements,
            });

            // Calcul équivalent mensuel pour la récurrence
            const abonnementMensuelEstime = calcAbonnementMensuel(brut, recurrence);

            // Enregistrement en Firestore
            const prochaine = recurrence.type === 'recurrent'
                ? prochaineEcheance(dateVirement, recurrence.intervalleNombre, recurrence.intervalleUnite)
                : null;

            const versRef = await addDoc(collection(db, 'versementsStripe'), {
                clientId: clientId || null,
                clientNom,
                periodeDebut: periodeDebut ? new Date(periodeDebut) : null,
                periodeFin: periodeFin ? new Date(periodeFin) : null,
                montantBrut: brut,
                fraisStripe: frais,
                montantNet: net,
                dateVirement: new Date(dateVirement),
                tvaApplicable: tvaOn,
                tauxTVA: tvaOn ? tauxTVA : null,
                montantHT: tvaOn ? montantHT : null,
                montantTVA: tvaOn ? montantTVA : null,
                recurrence: {
                    ...recurrence,
                    prochaineEcheance: prochaine,
                    montantFixe: recurrence.type === 'recurrent' ? doitEtreFixe(recurrence.occurrencesPassees) : false,
                },
                abonnementMensuelEstime: recurrence.type === 'recurrent' ? abonnementMensuelEstime : null,
                ecritureIds: [ecritureId],
                documentIds,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            // Lier les documents au versement
            for (const dId of documentIds) {
                await updateDoc(doc(db, 'documents', dId), { sourceId: versRef.id, sourceType: 'versement_stripe' });
            }

            // Mettre à jour la fiche client si rattaché
            if (clientId) {
                await updateDoc(doc(db, 'clients', clientId), {
                    totalEncaisseStripe: calculerTotalEncaisseApresAjout(clientId, brut),
                    updatedAt: serverTimestamp(),
                }).catch(() => { }); // non bloquant si le client n'existe plus
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
        setDone(false); setError(''); setMontantBrut(''); setFraisStripe(''); setClientId('');
        setClientNom('plusieurs / non détaillé'); setDocumentIds([]); setPeriodeDebut(''); setPeriodeFin('');
    }

    if (done) return (
        <div className="notice notice--success">
             Versement Stripe enregistré !{' '}
            <strong>Brut {formatMontant(brut)}  Net {formatMontant(net)}</strong>
            <button className="btn btn--sm btn--ghost" style={{ marginLeft: 12 }} onClick={reset}>
                Nouveau versement
            </button>
        </div>
    );

    return (
        <form onSubmit={handleSubmit}>
            <div className="page-header">
                <h1>Versement Stripe</h1>
                <p>Enregistrement d'un virement Stripe reçu sur votre compte bancaire.</p>
            </div>

            {error && <div className="notice notice--danger">{error}</div>}

            {/*  Client  */}
            <div className="card">
                <div className="card__title">
                     Client concerné
                    <Tooltip text="Facultatif. Si le virement regroupe plusieurs clients, choisissez 'Plusieurs / non détaillé'. Sinon, rattachez à un client pour faire apparaître ce versement sur sa fiche." />
                </div>
                <div className="form-group">
                    <label className="form-label">Client</label>
                    <select
                        className="form-select"
                        value={clientId}
                        onChange={(e) => {
                            setClientId(e.target.value);
                            if (!e.target.value) { setClientNom('plusieurs / non détaillé'); return; }
                            const c = clients.find((c) => c.id === e.target.value);
                            setClientNom(c?.nom ?? '');
                        }}
                    >
                        <option value="">Plusieurs clients / non détaillé</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                </div>
            </div>

            {/*  Période  */}
            <div className="card">
                <div className="card__title"> Période & virement</div>
                <div className="form-row--3 form-row">
                    <div className="form-group">
                        <label className="form-label">Début de période</label>
                        <DateInput className="form-input" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Fin de période</label>
                        <DateInput className="form-input" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Date du virement bancaire</label>
                        <DateInput className="form-input" value={dateVirement} onChange={(e) => setDateVirement(e.target.value)} required />
                    </div>
                </div>
            </div>

            {/*  Montants  */}
            <div className="card">
                <div className="card__title">
                     Montants
                    <Tooltip text="Saisissez les montants depuis votre relevé Stripe. Les frais sont ceux prélevés par Stripe (ils varient selon le type de carte et le pays du client)." />
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Montant brut encaissé ()</label>
                        <input
                            type="number" min="0" step="0.01" className="form-input" required
                            value={montantBrut}
                            onChange={(e) => setMontantBrut(e.target.value)}
                            placeholder="Ex. 350.00"
                        />
                        <p className="form-hint">Somme des paiements clients avant frais Stripe.</p>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Frais Stripe prélevés ()</label>
                        <input
                            type="number" min="0" step="0.01" className="form-input"
                            value={fraisStripe}
                            onChange={(e) => setFraisStripe(e.target.value)}
                            placeholder="Ex. 10.50"
                        />
                        <p className="form-hint">Prélevés par Stripe  à lire sur le relevé.</p>
                    </div>
                </div>

                {/* Récap montant net */}
                <div style={{ marginTop: 8, padding: '12px 16px', background: 'var(--bg3)', borderRadius: 'var(--radius)', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 14 }}>
                    <span>Brut : <strong>{formatMontant(brut)}</strong></span>
                    <span>Frais Stripe : <strong style={{ color: 'var(--danger)' }}> {formatMontant(frais)}</strong></span>
                    <span>
                        Net viré :{' '}
                        <strong style={{ color: net >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: 16 }}>
                            {formatMontant(net)}
                        </strong>
                    </span>
                </div>
            </div>

            {/*  TVA  */}
            <div className="card">
                <div className="card__title">
                     TVA
                    <Tooltip text={TVA_TOOLTIP} />
                </div>
                <ToggleSwitch id="tva-stripe" label="TVA applicable" checked={tvaOn} onChange={setTvaOn} tooltip={TVA_TOOLTIP} />
                {tvaOn && (
                    <>
                        <div className="form-group" style={{ marginTop: 12 }}>
                            <label className="form-label">Taux TVA (%)</label>
                            <input type="number" className="form-input" style={{ width: 100 }} value={tauxTVA} onChange={(e) => setTauxTVA(parseFloat(e.target.value) || 20)} />
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                            HT : <strong style={{ color: 'var(--text)' }}>{formatMontant(montantHT)}</strong>
                            {' '} TVA : <strong style={{ color: 'var(--text)' }}>{formatMontant(montantTVA)}</strong>
                        </div>
                    </>
                )}
            </div>

            {/*  Récurrence  */}
            <div className="card">
                <div className="card__title">
                     Récurrence abonnement
                    <Tooltip text="Si ce client paie un abonnement récurrent via Stripe, indiquez la fréquence pour estimer son CA mensuel. Aucune écriture n'est générée automatiquement  chaque virement Stripe réel sera saisi manuellement via ce formulaire." />
                </div>
                <SelecteurFrequence
                    value={recurrence}
                    onChange={setRecurrence}
                    occurrencesPassees={recurrence.occurrencesPassees ?? 0}
                />
                {recurrence.type === 'recurrent' && (
                    <p className="form-hint" style={{ marginTop: 8 }}>
                        Abonnement mensuel estimé :{' '}
                        <strong>{formatMontant(calcAbonnementMensuel(brut, recurrence))}</strong> / mois
                    </p>
                )}
            </div>

            {/*  Justificatifs  */}
            <div className="card">
                <div className="card__title"> Relevé Stripe</div>
                <FileUpload
                    sourceType="versement_stripe"
                    sourceId={null}
                    onUploaded={({ documentId }) => setDocumentIds((p) => [...p, documentId])}
                />
                <p className="form-hint" style={{ marginTop: 8 }}>PDF ou CSV exporté depuis le dashboard Stripe.</p>
            </div>

            {/*  Détail écritures  */}
            <div className="card" style={{ borderColor: 'var(--border-focus)' }}>
                <div className="card__title"> Écritures qui seront générées</div>
                <div className="table-wrap">
                    <table>
                        <thead><tr><th>Compte</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Débit</th><th style={{ textAlign: 'right' }}>Crédit</th></tr></thead>
                        <tbody>
                            {buildMouvements(net, frais, montantHT, montantTVA, tvaOn, clientNom).map((m, i) => (
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

            <button type="submit" className="btn btn--primary" disabled={saving || !brut} style={{ minWidth: 180 }}>
                {saving ? 'Enregistrement' : ' Enregistrer le versement'}
            </button>
        </form>
    );
}

//  Helpers locaux 

function buildMouvements(net, frais, montantHT, montantTVA, tvaOn, clientNom) {
    const brut = +(net + frais).toFixed(2);
    if (!brut && !frais && !net) return [];

    if (!tvaOn) {
        return [
            { compte: '512', libelle: 'Banque  virement Stripe', debit: net, credit: 0 },
            { compte: '6278', libelle: 'Frais Stripe', debit: frais, credit: 0 },
            { compte: '706', libelle: `Prestations  ${clientNom}`, debit: 0, credit: brut },
        ].filter((m) => m.debit || m.credit);
    }
    return [
        { compte: '512', libelle: 'Banque  virement Stripe', debit: net, credit: 0 },
        { compte: '6278', libelle: 'Frais Stripe', debit: frais, credit: 0 },
        { compte: '706', libelle: `Prestations HT  ${clientNom}`, debit: 0, credit: montantHT },
        { compte: '4457', libelle: 'TVA collectée', debit: 0, credit: montantTVA },
    ].filter((m) => m.debit || m.credit);
}

/**
 * Convertit un montant récurrent en équivalent mensuel.
 */
function calcAbonnementMensuel(montant, recurrence) {
    if (recurrence.type !== 'recurrent') return 0;
    const { intervalleNombre: n, intervalleUnite: u } = recurrence;
    const joursParCycle = u === 'jour' ? n : u === 'semaine' ? n * 7 : u === 'mois' ? n * 30.44 : n * 365.25;
    return +((montant / joursParCycle) * 30.44).toFixed(2);
}

// Placeholder  le calcul réel se fait côté fiche client en agrégeant les versements
function calculerTotalEncaisseApresAjout() { return null; }
