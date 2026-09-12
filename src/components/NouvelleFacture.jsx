/**
 * Formulaire "Facturer un client"
 * 
 * Génère automatiquement les écritures comptables via la fonction garde-fou.
 * L'utilisateur ne voit jamais les numéros de comptes ni le débit/crédit.
 */
import { useState, useEffect } from 'react';
import {
    collection, addDoc, serverTimestamp,
    getDocs, query, orderBy, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ecrireEcriture } from '../services/api';
import { genererNumeroFacture, calculerTTCdepuisHT, formatMontant, getSettings } from '../services/helpers';
import { prochaineEcheance, doitEtreFixe } from '../services/helpers';
import { Tooltip, ToggleSwitch, SelecteurFrequence } from './Shared';
import { FileUpload } from './FileUpload';

const TVA_TOOLTIP = `En franchise en base de TVA, vous ne facturez pas la TVA à vos clients et n'avez pas à la reverser à l'État. C'est le statut actuel de votre société. Si vous passez au régime réel, activez ce toggle et renseignez le taux.`;

function LigneFacture({ ligne, index, onChange, onRemove }) {
    return (
        <div className="card" style={{ marginBottom: 12, background: 'var(--bg3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Ligne {index + 1}</strong>
                <button type="button" className="btn btn--icon btn--ghost" onClick={onRemove} title="Supprimer la ligne"></button>
            </div>

            <div className="form-row">
                <div className="form-group">
                    <label className="form-label">Description</label>
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Ex. Création du site"
                        value={ligne.description}
                        onChange={(e) => onChange({ ...ligne, description: e.target.value })}
                    />
                </div>
                <div className="form-group">
                    <label className="form-label">Montant HT ()</label>
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="form-input"
                        value={ligne.montant}
                        onChange={(e) => onChange({ ...ligne, montant: parseFloat(e.target.value) || 0 })}
                    />
                </div>
            </div>

            <div className="form-group">
                <label className="form-label">Fréquence</label>
                <SelecteurFrequence
                    value={ligne.recurrence}
                    onChange={(rec) => onChange({ ...ligne, recurrence: rec })}
                    occurrencesPassees={ligne.recurrence?.occurrencesPassees ?? 0}
                />
            </div>
        </div>
    );
}

function defaultLigne() {
    return {
        description: '',
        montant: 0,
        recurrence: { type: 'ponctuel', intervalleNombre: 1, intervalleUnite: 'mois', montantFixe: false, occurrencesPassees: 0 },
    };
}

export function NouvelleFacture({ onCreated }) {
    const { user } = useAuth();

    const [clients, setClients] = useState([]);
    const [settings, setSettings] = useState({ statutTVA: 'franchise', tauxTVADefaut: 20 });
    const [clientQuery, setClientQuery] = useState('');
    const [clientId, setClientId] = useState('');
    const [clientNom, setClientNom] = useState('');
    const [nouveau, setNouveau] = useState(false);
    const [lignes, setLignes] = useState([defaultLigne()]);
    const [tvaOn, setTvaOn] = useState(false);
    const [tauxTVA, setTauxTVA] = useState(20);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [dejaEnc, setDejaEnc] = useState(false);
    const [dateEnc, setDateEnc] = useState('');
    const [documentIds, setDocumentIds] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);

    // Charger clients + settings
    useEffect(() => {
        getDocs(query(collection(db, 'clients'), orderBy('nom'))).then((snap) =>
            setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
        getSettings().then((s) => {
            setSettings(s);
            setTvaOn(s.statutTVA === 'redevable');
            setTauxTVA(s.tauxTVADefaut ?? 20);
        });
    }, []);

    const totalHT = lignes.reduce((s, l) => s + (l.montant || 0), 0);
    const { tva, ttc } = tvaOn ? calculerTTCdepuisHT(totalHT, tauxTVA) : { tva: 0, ttc: totalHT };

    async function handleSubmit(e) {
        e.preventDefault();
        setError(''); setSaving(true);

        try {
            // 1. Créer/récupérer le client
            let cId = clientId;
            let cNom = clientNom.trim();
            if (nouveau) {
                if (!cNom) { setError('Nom du nouveau client requis.'); setSaving(false); return; }
                const ref = await addDoc(collection(db, 'clients'), { nom: cNom, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                cId = ref.id;
            } else {
                if (!cId) { setError('Veuillez sélectionner un client.'); setSaving(false); return; }
            }

            // 2. Numéro facture
            const { numero, numeroSeq, annee } = await genererNumeroFacture();

            // 3. Écritures au journal VE (une écriture par ligne)
            const ecritureVenteIds = [];
            for (const ligne of lignes) {
                const { debit411, credit706, credit4457 } = buildMouvementsVente(ligne.montant, tvaOn, tauxTVA, tva, ttc, lignes, cNom);
                const mouvements = buildMouvementsVente(ligne.montant, tvaOn, tauxTVA, 0, 0, [ligne], cNom);

                // Calculer montants pour cette ligne
                const ligneHT = ligne.montant;
                const ligneTVA = tvaOn ? +(ligneHT * tauxTVA / 100).toFixed(2) : 0;
                const ligneTTC = +(ligneHT + ligneTVA).toFixed(2);

                const mvts = buildMouvementsPourLigne(ligneHT, ligneTVA, ligneTTC, tvaOn, cNom, numero);
                const { ecritureId } = await ecrireEcriture({
                    journal: 'VE',
                    date,
                    libelle: `Facture ${numero}  ${cNom}  ${ligne.description}`,
                    pieceRef: numero,
                    sourceType: 'facture',
                    mouvements: mvts,
                });
                ecritureVenteIds.push(ecritureId);
            }

            // 4. Écriture d'encaissement si déjà encaissée
            const ecritureEncaissIds = [];
            if (dejaEnc) {
                for (const ecId of ecritureVenteIds) {
                    // On construit une écriture BQ globale (débit 512, crédit 411)
                }
                const mvtEnc = [
                    { compte: '512', libelle: 'Banque', debit: ttc, credit: 0 },
                    { compte: '411', libelle: cNom, debit: 0, credit: ttc },
                ];
                const { ecritureId } = await ecrireEcriture({
                    journal: 'BQ',
                    date: dateEnc || date,
                    libelle: `Encaissement facture ${numero}  ${cNom}`,
                    pieceRef: numero,
                    sourceType: 'facture',
                    mouvements: mvtEnc,
                });
                ecritureEncaissIds.push(ecritureId);
            }

            // 5. Créer le document Facture dans Firestore
            const factureRef = await addDoc(collection(db, 'factures'), {
                numero, numeroSeq, annee,
                clientId: cId, clientNom: cNom,
                dateFacture: new Date(date),
                statut: dejaEnc ? 'encaissee' : 'en_attente',
                dateEncaissement: dejaEnc ? new Date(dateEnc || date) : null,
                tvaApplicable: tvaOn,
                tauxTVA: tvaOn ? tauxTVA : null,
                totalHT, totalTVA: tva, totalTTC: ttc,
                ecritureVenteIds,
                ecritureEncaissIds,
                documentIds,
                createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            });

            // 6. Créer les lignes en sous-collection
            for (const ligne of lignes) {
                const prochaine = ligne.recurrence.type === 'recurrent'
                    ? prochaineEcheance(date, ligne.recurrence.intervalleNombre, ligne.recurrence.intervalleUnite)
                    : null;
                await addDoc(collection(db, 'factures', factureRef.id, 'lignes'), {
                    ...ligne,
                    recurrence: {
                        ...ligne.recurrence,
                        prochaineEcheance: prochaine,
                        montantFixe: ligne.recurrence.type === 'recurrent'
                            ? doitEtreFixe(ligne.recurrence.occurrencesPassees)
                            : false,
                    },
                    statutLigne: 'active',
                    createdAt: serverTimestamp(),
                });
            }

            // Lier les documents justificatifs à la facture
            for (const dId of documentIds) {
                const dRef = doc(db, 'documents', dId);
                await updateDoc(dRef, { sourceId: factureRef.id });
            }

            setDone({ numero, factureId: factureRef.id });
            onCreated?.({ numero, factureId: factureRef.id });
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    if (done) return (
        <div className="notice notice--success">
             Facture <strong>{done.numero}</strong> créée avec succès !
            <button className="btn btn--sm btn--ghost" style={{ marginLeft: 12 }} onClick={() => { setDone(null); setLignes([defaultLigne()]); setClientId(''); setClientNom(''); setDocumentIds([]); }}>
                Nouvelle facture
            </button>
        </div>
    );

    return (
        <form onSubmit={handleSubmit}>
            <div className="page-header">
                <h1>Facturer un client</h1>
                <p>Un formulaire simple  les écritures comptables sont générées automatiquement.</p>
            </div>

            {error && <div className="notice notice--danger">{error}</div>}

            {/*  Client  */}
            <div className="card">
                <div className="card__title"> Client</div>
                <div className="form-group">
                    <ToggleSwitch
                        id="nouveau-client"
                        label="Nouveau client"
                        checked={nouveau}
                        onChange={setNouveau}
                    />
                </div>

                {nouveau ? (
                    <div className="form-group">
                        <label className="form-label">Nom du nouveau client</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Ex. Dupont SAS"
                            value={clientNom}
                            onChange={(e) => setClientNom(e.target.value)}
                        />
                        <p className="form-hint">Le reste des informations (email, adresse, SIRET) se complète ensuite sur la fiche client.</p>
                    </div>
                ) : (
                    <div className="form-group">
                        <label className="form-label">Client existant</label>
                        <select
                            className="form-select"
                            value={clientId}
                            onChange={(e) => {
                                setClientId(e.target.value);
                                const c = clients.find((c) => c.id === e.target.value);
                                setClientNom(c?.nom ?? '');
                            }}
                        >
                            <option value=""> Choisir un client </option>
                            {clients
                                .filter((c) => !clientQuery || c.nom.toLowerCase().includes(clientQuery.toLowerCase()))
                                .map((c) => (
                                    <option key={c.id} value={c.id}>{c.nom}</option>
                                ))}
                        </select>
                    </div>
                )}
            </div>

            {/*  Lignes  */}
            <div className="card">
                <div className="card__title"> Lignes de la facture</div>
                {lignes.map((l, i) => (
                    <LigneFacture
                        key={i}
                        ligne={l}
                        index={i}
                        onChange={(updated) => setLignes((prev) => prev.map((x, j) => j === i ? updated : x))}
                        onRemove={() => setLignes((prev) => prev.filter((_, j) => j !== i))}
                    />
                ))}
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setLignes((prev) => [...prev, defaultLigne()])}
                >
                    + Ajouter une ligne
                </button>

                {/* Total */}
                <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg3)', borderRadius: 'var(--radius)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <span>HT : <strong>{formatMontant(totalHT)}</strong></span>
                    {tvaOn && <span>TVA {tauxTVA}% : <strong>{formatMontant(tva)}</strong></span>}
                    <span>Total : <strong style={{ color: 'var(--accent)' }}>{formatMontant(ttc)}</strong></span>
                </div>
            </div>

            {/*  TVA  */}
            <div className="card">
                <div className="card__title">
                     TVA
                    <Tooltip text={TVA_TOOLTIP} />
                </div>
                <ToggleSwitch
                    id="tva-on"
                    label="TVA applicable"
                    checked={tvaOn}
                    onChange={setTvaOn}
                    tooltip={TVA_TOOLTIP}
                />
                {tvaOn && (
                    <div className="form-group" style={{ marginTop: 12 }}>
                        <label className="form-label">Taux TVA (%)</label>
                        <input
                            type="number"
                            className="form-input"
                            style={{ width: 100 }}
                            value={tauxTVA}
                            onChange={(e) => setTauxTVA(parseFloat(e.target.value) || 20)}
                        />
                    </div>
                )}
            </div>

            {/*  Date & Encaissement  */}
            <div className="card">
                <div className="card__title"> Date & paiement</div>
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Date de la facture</label>
                        <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                </div>
                <ToggleSwitch
                    id="deja-enc"
                    label="Déjà encaissée"
                    checked={dejaEnc}
                    onChange={setDejaEnc}
                    tooltip={`"En attente de paiement" : votre client vous doit l'argent mais ne l'a pas encore versé. "Payée" : l'argent est arrivé sur votre compte bancaire.`}
                />
                {dejaEnc && (
                    <div className="form-group" style={{ marginTop: 10 }}>
                        <label className="form-label">Date d'encaissement</label>
                        <input type="date" className="form-input" style={{ width: 200 }} value={dateEnc} onChange={(e) => setDateEnc(e.target.value)} />
                    </div>
                )}
            </div>

            {/*  Justificatifs  */}
            <div className="card">
                <div className="card__title"> Justificatifs</div>
                <FileUpload
                    sourceType="facture"
                    sourceId={null}
                    onUploaded={({ documentId }) => setDocumentIds((prev) => [...prev, documentId])}
                />
            </div>

            <button type="submit" className="btn btn--primary" disabled={saving} style={{ minWidth: 160 }}>
                {saving ? 'Enregistrement' : ' Créer la facture'}
            </button>
        </form>
    );
}

//  Helpers locaux 

function buildMouvementsPourLigne(ligneHT, ligneTVA, ligneTTC, tvaOn, clientNom, numero) {
    if (!tvaOn) {
        return [
            { compte: '411', libelle: `Client ${clientNom}  Fact. ${numero}`, debit: ligneHT, credit: 0 },
            { compte: '706', libelle: 'Prestations de services', debit: 0, credit: ligneHT },
        ];
    }
    return [
        { compte: '411', libelle: `Client ${clientNom}  Fact. ${numero}`, debit: ligneTTC, credit: 0 },
        { compte: '706', libelle: 'Prestations de services (HT)', debit: 0, credit: ligneHT },
        { compte: '4457', libelle: `TVA collectée`, debit: 0, credit: ligneTVA },
    ];
}
