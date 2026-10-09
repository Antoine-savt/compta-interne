/**
 * tva.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Régime de TVA de la société (Réglages) et calculs associés.
 * - Franchise en base (art. 293 B CGI) : aucune TVA facturée ni récupérée ; les
 *   formulaires masquent les options de TVA.
 * - Redevable : TVA collectée sur les ventes (44571), déductible sur les achats (44566).
 */
import { useEffect, useState } from 'react';
import { getSettings } from './helpers';

export const MENTION_FRANCHISE = 'TVA non applicable, art. 293 B du CGI';

/** Régime de TVA courant : { franchise, taux, charge } (franchise par défaut tant que non chargé). */
export function useRegimeTVA() {
    const [regime, setRegime] = useState({ franchise: true, taux: 20, charge: false });
    useEffect(() => {
        getSettings()
            .then((s) => setRegime({ franchise: (s.statutTVA ?? 'franchise') !== 'redevable', taux: s.tauxTVADefaut ?? 20, charge: true }))
            .catch(() => setRegime((r) => ({ ...r, charge: true })));
    }, []);
    return regime;
}

/** Ventile un montant TTC : { ht, tva }. */
export function tvaDepuisTTC(ttc, taux) {
    const tva = +(ttc * taux / (100 + taux)).toFixed(2);
    return { ht: +(ttc - tva).toFixed(2), tva };
}

/** Calcule la TVA sur un montant HT : { ht, tva, ttc }. */
export function tvaDepuisHT(ht, taux) {
    const tva = +(ht * taux / 100).toFixed(2);
    return { ht: +ht.toFixed(2), tva, ttc: +(ht + tva).toFixed(2) };
}
