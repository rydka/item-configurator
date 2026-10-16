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
| `scripts/core/`, `scripts/ai/` | Logique pure testable (droits, types, conversion, instantané, analyse `analyze.mjs`, jeu de changements `changes.mjs` (`buildChangeSet`, `applySelection`, `pruneChangeSet`), recoupement règles / Claude `crosscheck.mjs` (`factsFromRules`, `factsFromClaude`, `crossCheck`, `CROSSCHECK_POLICY`), orchestration « Claude d'abord » `analyze-claude.mjs` (`analyzeClaudeFirst` : règles + un appel Claude, validation, construction, recoupement, repli sur les règles), ligne d'en-tête `header.mjs`, utilitaires de chemins `paths.mjs` ; mode Claude d'abord : énumérations et schéma de sortie `claude-schema.mjs` (`schemaEnums`, `buildItemSchema`, `DETAIL_FIELDS`), prompt système et requête `claude-prompt.mjs` (`SYSTEM_PROMPT` avec deux exemples synthétiques, `describeForClaude`, `buildClaudeRequest`), validation `claude-validate.mjs` (`validateClaudeItem`, `toWorldDistance`, codes `REASONS`), construction `claude-build.mjs` (`buildFromClaude` : activités écrites directement, effets par `parser.toEffects`, descripteurs) ; clients Ollama `ollama.mjs` et Anthropic `anthropic.mjs`, prompt et schéma d'Ollama `prompt.mjs`, résolveur Ollama `resolver.mjs` : `createOllamaResolver`, `createResolver(config)` ; `createAnthropicResolver` n'est plus branché, gardé pour la mesure comparative) |
| `scripts/foundry/` | Couche Foundry : bouton, fenêtres (type avec progression, aperçu avec groupe « À vérifier », cases et marques, réglages IA), application, annulation, API. `analysis.mjs` est le seul appelant de `core/analyze.mjs`, `core/analyze-claude.mjs` et `buildChangeSet` ; l'aperçu applique `applySelection` à « Appliquer » |
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

- **Hook `renderItemSheet5e`** (`scripts/foundry/sheet-button.mjs`, aussi déclenché pour la fiche de contenant) : trois points d'entrée, même règles d'accès (C1, C2, C14).
  - Barre d'outils `.item-configurator-toolbar` (boutons avec icône et texte `.item-configurator-configure-button` « Configurer » et `.item-configurator-undo-button` « Annuler la dernière configuration »), insérée après la partie `[data-application-part="header"]` (repli : `.sheet-header`) de la fiche dnd5e, donc entre l'en-tête et les onglets. C'est un frère des parties Handlebars : il survit aux re-rendus partiels et n'est que rafraîchi.
  - Icônes de la barre de titre `.item-configurator-configure` / `.item-configurator-undo` dans `.window-header`, avant `[data-action="copyUuid"], [data-action="close"]` (même technique que dnd5e).
  - Compendium verrouillé : boutons et icônes `disabled` avec l'infobulle `Button.LockedPack`.
  - Aucune méthode remplacée. Une autre fiche d'objet (Tidy5e) n'aurait ni la barre ni les icônes ; `api.configure` reste disponible.
- **Hook `getHeaderControlsItemSheet5e`** (`scripts/foundry/sheet-button.mjs`) : ajoute les entrées « Configurer depuis la description » et « Annuler la dernière configuration » (actions `item-configurator-configure`, `item-configurator-undo`, `onClick` propre) au menu « ⋮ » de la fiche. Le hook est rappelé à chaque ouverture du menu ; sur un compendium verrouillé l'entrée affiche l'avertissement `Button.LockedPack` au lieu d'agir.
- **`item.update({ type, system: _replace(...) })`** : conversion de type sur place (`foundry/apply.mjs`, `foundry/undo.mjs`). Les `updateItem` tiers (enhancedcombathud) voient `changed.system` en remplacement forcé.
- **Création / suppression d'effets et d'activités** sur l'objet configuré (`createEmbeddedDocuments("ActiveEffect", …, { keepId: true })`), flag `flags.item-configurator.undo` écrit sur l'objet.
- **Menu de réglages** `item-configurator.ai` (ApplicationV2, MJ seulement) : fournisseur (`aiProvider` : `ollama` ou `anthropic`), réglages Ollama (`ollamaUrl`, `ollamaModel`, `aiTimeout`) et Anthropic (`anthropicModel`, `anthropicEffort`, `anthropicTimeout` de 10 à 180 s, défaut 60, `anthropicApiKey`) ; la liste des modèles est lue sur Ollama à son ouverture. La clé API est en portée **`client`** (navigateur du MJ), jamais dans le monde.
- **`fetch` vers Ollama** (`localhost:11434` par défaut) : seulement à l'ouverture du menu IA, à l'ouverture de la fenêtre de type (réchauffage) et à l'analyse. Aucun appel au chargement. `createResolver` (`scripts/ai/resolver.mjs`) ne crée qu'un résolveur Ollama ; pour le fournisseur `anthropic` il rend `null` (le mode Claude d'abord ne passe pas par le résolveur phrase par phrase).
- **`fetch` vers `https://api.anthropic.com/v1/messages`** (`scripts/ai/anthropic.mjs`, fournisseur `anthropic`, mode « Claude d'abord » choisi par `runAnalysis` dans `scripts/foundry/analysis.mjs`, orchestration pure dans `scripts/core/analyze-claude.mjs`) : **un seul appel par objet**, seulement à l'analyse, par le MJ (`game.user.isGM`, un joueur obtient les règles seules), quand l'IA est activée et qu'une clé est enregistrée dans ce navigateur ; la fenêtre de type affiche la progression (règles, Claude avec compteur contre `anthropicTimeout`, recoupement) et un bouton Annuler qui interrompt l'appel (`AbortSignal`) : l'aperçu montre alors les règles seules ; le nom, le type et la description complète de l'objet partent chez Anthropic (avertissement affiché dans le menu). En-têtes `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`, `anthropic-beta: server-side-fallback-2026-07-01` ; `system` sous forme de blocs avec `cache_control: { type: "ephemeral" }` sur le prompt stable ; sortie contrainte par un schéma JSON (`output_config.format`) ; `max_tokens` 8 000 ; une seule nouvelle tentative sur 429 / 5xx. `proposal.ai` porte le `model` servi (le repli côté serveur peut en changer) et `usage { input, output, cacheRead, cacheWrite }` (diagnostic, non affiché).
- **Module requis** `dnd5e-text-parser` : importé de `/modules/dnd5e-text-parser/scripts/index.mjs` (version d'API majeure 1 exigée).
- **Compendiums de sorts `dnd5e.spells24` / `dnd5e.spells`** (lecture de l'index, `foundry/analysis.mjs`) : seulement quand la description parle d'incantation, pour retrouver le sort d'une activité « lancer un sort » (noms anglais).
- **Objets de base** (`foundry/analysis.mjs`) : les UUID de `CONFIG.DND5E.weaponIds`, `armorIds`, `shieldIds` sont résolus (`foundry.utils.parseUuid`, index du pack lu une fois, puis `fromUuid` sur l'objet retenu) quand le nom complet de l'objet de base figure dans le nom de l'objet configuré. Un module qui modifie ces tables change les objets de base proposés.
- **`item.system.contentsCount`** (dnd5e `ContainerData`, `foundry/analysis.mjs`) : lu avant d'analyser un contenant vers un autre type ; la conversion d'un contenant non vide est refusée (dnd5e 6.0.6 ne gère pas le contenu d'un contenant qui change de type).
- **Hooks personnalisés émis** : `item-configurator.previewReady` (`{ item, proposal, durationMs }`), `item-configurator.applied` (`item`).
- **API** : `game.modules.get("item-configurator").api.configure(item, { type, subtype, variant, useAI, replace, apply })`.
- **CSS** : tout sous `.item-configurator`, `.item-configurator-toolbar`, `.item-configurator-configure`, `.item-configurator-undo`.
