# Item Configurator

Configure a dnd5e item (details, activities, active effects) from its description, with a preview and optional local AI.

Module Foundry VTT v14 pour le système dnd5e 6.x.

## Installation

Dans Foundry : **Add-on Modules → Install Module**, puis coller l'adresse du manifeste :

```
https://github.com/rydka/item-configurator/releases/latest/download/module.json
```

## Utilisation

À compléter.

## API

`game.modules.get("item-configurator").api` (disponible après le hook `init`, chargée au premier appel) :

- `open(item)` : ouvre l'interface du module sur l'objet, exactement comme le bouton de la fiche (fenêtre de choix du type, puis aperçu). Renvoie une promesse résolue avec la fenêtre affichée. Rejette avec une `Error` au message localisé si l'utilisateur ne peut pas configurer l'objet (`errors.notAllowed` : ni MJ ni propriétaire autorisé, ou type non pris en charge) ou si l'objet est dans un compendium verrouillé (`Button.LockedPack`). Aucune notification n'est affichée : c'est à l'appelant de le faire.
- `configure(item, { type, subtype, variant, useAI, replace, apply, signal })` : analyse sans interface, mêmes règles d'accès ; renvoie `{ proposal, changeSet, applied }`.

Exemple pour un autre module :

```js
const api = game.modules.get("item-configurator")?.api;
if (api?.open) await api.open(item).catch((err) => ui.notifications.warn(err.message));
```

## Développement

```
npm install
npm test        # tests unitaires
npm run lint
```
