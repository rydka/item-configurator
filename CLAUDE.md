# Item Configurator (`item-configurator`)

Module Foundry VTT de l'atelier (voir le `CLAUDE.md` de l'atelier, deux niveaux au-dessus, pour les règles communes). Ce fichier fait foi pour ce module.

## Objectif

Configure a dnd5e item (details, activities, active effects) from its description, with a preview and optional local AI.

## Cibles

Foundry v14, dnd5e 6.x. Toute API utilisée doit exister dans ces versions. Consulter les sources en lecture seule :
- Foundry : `C:/Users/Shadow/AppData/Local/Programs/Foundry Virtual Tabletop/resources/app`
- dnd5e : `C:/Users/Shadow/AppData/Local/FoundryVTT/Data/systems/dnd5e`

## Structure

| Chemin | Contenu |
|---|---|
| `module.json` | Manifeste. `version` est réécrite par le workflow de release. |
| `scripts/main.mjs` | Point d'entrée : hooks `init` et `ready`, hook de fiche, API |
| `scripts/core/`, `scripts/ai/` | Logique pure testable (droits, types, conversion, instantané, analyse `analyze.mjs`, jeu de changements `changes.mjs`, utilitaires de chemins `paths.mjs` ; client Ollama, prompt, résolveur) |
| `scripts/foundry/` | Couche Foundry : bouton, fenêtres (type, aperçu, réglages IA), application, annulation, API. `analysis.mjs` est le seul appelant de `core/analyze.mjs` et `core/changes.mjs` |
| `styles/item-configurator.css` | Styles, tous sous la classe `.item-configurator` |
| `lang/` | Traductions `en` et `fr`, clés sous `item-configurator.*` |
| `templates/` | Templates Handlebars |
| `tests/unit/` | Tests Vitest avec les faux globaux Foundry de `tests/setup/` |
| `tests/integration/` | Tests dans un vrai Foundry, servent de preuve de fonctionnement |

## Conventions

- Tout ce que le module ajoute est préfixé par l'identifiant `item-configurator` : réglages, flags, sockets, clés de traduction, classes CSS, hooks personnalisés (`item-configurator.<nom>`).
- Pas de modification directe des prototypes de Foundry ou de dnd5e. Préférer les hooks et l'API publique. Si c'est impossible, le documenter ici dans « Points de contact avec d'autres modules ».
- Toute logique testable est exportée depuis un fichier sans effet de bord à l'import (sauf l'enregistrement de hooks dans `main.mjs`).

## Commandes

```
npm install
npm test
npm run lint
```

## Points de contact avec d'autres modules

Liste maintenue par le développeur et lue par le vérificateur : hooks écoutés, méthodes remplacées, sélecteurs CSS globaux, modules tiers détectés ou adaptés.

- **Hook `renderItemSheet5e`** (`scripts/foundry/sheet-button.mjs`) : insère les boutons « Configurer » et « Annuler » (`.item-configurator-configure`, `.item-configurator-undo`) dans `.window-header`, avant `[data-action="copyUuid"], [data-action="close"]` (même technique que dnd5e). Aucune méthode remplacée. Une autre fiche d'objet (Tidy5e) n'aurait pas le bouton ; `api.configure` reste disponible.
- **`item.update({ type, system: _replace(...) })`** : conversion de type sur place (`foundry/apply.mjs`, `foundry/undo.mjs`). Les `updateItem` tiers (enhancedcombathud) voient `changed.system` en remplacement forcé.
- **Création / suppression d'effets et d'activités** sur l'objet configuré (`createEmbeddedDocuments("ActiveEffect", …, { keepId: true })`), flag `flags.item-configurator.undo` écrit sur l'objet.
- **Menu de réglages** `item-configurator.ai` (ApplicationV2, MJ seulement) ; la liste des modèles est lue sur Ollama à son ouverture.
- **`fetch` vers Ollama** (`localhost:11434` par défaut) : seulement à l'ouverture du menu IA, à l'ouverture de la fenêtre de type (réchauffage) et à l'analyse. Aucun appel au chargement.
- **Module requis** `dnd5e-text-parser` : importé de `/modules/dnd5e-text-parser/scripts/index.mjs` (version d'API majeure 1 exigée).
- **Compendiums de sorts `dnd5e.spells24` / `dnd5e.spells`** (lecture de l'index, `foundry/analysis.mjs`) : seulement quand la description parle d'incantation, pour retrouver le sort d'une activité « lancer un sort » (noms anglais).
- **Hooks personnalisés émis** : `item-configurator.previewReady` (`{ item, proposal, durationMs }`), `item-configurator.applied` (`item`).
- **API** : `game.modules.get("item-configurator").api.configure(item, { type, subtype, variant, useAI, replace, apply })`.
- **CSS** : tout sous `.item-configurator`, `.item-configurator-configure`, `.item-configurator-undo`.
