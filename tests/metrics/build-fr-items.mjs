// Builds fixtures/reference/fr-items.json: 20 of the 70 EN items with a hand-written French name and
// description. `truth` is copied unchanged from srd-items.json. Run once: node tests/metrics/build-fr-items.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "reference");
const FR = {
  "Vicious Handaxe": ["Hachette vicieuse", "Cette hache à une main est légère et équilibrée pour le lancer, tout en restant efficace au corps à corps. Quand vous obtenez un 20 au jet d'attaque avec cette arme magique, votre coup critique inflige 2d6 dégâts supplémentaires du type de l'arme."],
  "Shortsword +1": ["Épée courte +1", "Que ce soit par une bénédiction démoniaque, un legs céleste, une expérience insensée ou un savoir-faire exceptionnel, cette arme a été améliorée pour semer plus de sang entre les mains de son porteur. Vous obtenez un bonus aux jets d'attaque et de dégâts effectués avec cette arme magique."],
  "Elven Chain": ["Cotte de mailles elfique", "Vous bénéficiez d'un bonus de +1 à la CA tant que vous portez cette armure. Vous la maîtrisez même si vous ne maîtrisez pas les armures intermédiaires."],
  "Splint Armor +3": ["Armure de plates à bandes +3", "Cette armure a été ornée de runes puissantes, forgée dans des feux ensorcelés, bénie par un être puissant, ou un autre événement lui a conféré une protection accrue pour celui qui la porte. Vous obtenez un bonus à la CA tant que vous portez cette armure."],
  "Breastplate Armor of Resistance": ["Cuirasse de résistance", "(Nécessite un lien d'harmonisation) Vous avez la résistance à un type de dégâts tant que vous portez cette armure. Le MJ choisit le type ou le détermine au hasard."],
  "Adamantine Chain Mail": ["Cotte de mailles d'adamantium", "Cette armure est renforcée d'adamantium, l'une des substances les plus dures qui existent. Tant que vous la portez, tout coup critique porté contre vous devient un coup normal."],
  "Gauntlets of Ogre Power": ["Gantelets de puissance d'ogre", "Objet merveilleux. Votre valeur de Force est de 19 tant que vous portez ces gantelets. Ils n'ont aucun effet sur vous si votre Force est déjà de 19 ou plus."],
  "Cloak of Protection": ["Cape de protection", "Objet merveilleux, (nécessite un lien d'harmonisation) Vous bénéficiez d'un bonus de +1 à la CA et aux jets de sauvegarde tant que vous portez cette cape."],
  "Boots of the Winterlands": ["Bottes des terres hivernales", "Objet merveilleux, (nécessite un lien d'harmonisation) Ces bottes fourrées sont bien ajustées et très chaudes. Tant que vous les portez, vous bénéficiez des avantages suivants : vous avez la résistance aux dégâts de froid. Vous ignorez le terrain difficile créé par la glace ou la neige. Vous supportez des températures allant jusqu'à -45 degrés Celsius sans protection supplémentaire. Si vous portez des vêtements épais, vous supportez jusqu'à -70 degrés Celsius."],
  "Potion of Healing (Greater)": ["Potion de soins (supérieure)", "Potion, peu commun. Vous récupérez 4d4 + 4 points de vie quand vous buvez cette potion. Quelle que soit sa puissance, le liquide rouge de la potion scintille quand on l'agite."],
  "Potion of Poison": ["Potion de poison", "Potion, peu commun. Cette concoction a l'aspect, l'odeur et le goût d'une potion de soins ou d'une autre potion bénéfique. En réalité, c'est un poison masqué par une illusion magique. Le sort Identification révèle sa vraie nature. Si vous buvez cette potion, vous subissez 4d6 dégâts de poison et devez réussir un jet de sauvegarde de Constitution DD 13 sous peine d'être empoisonné pendant 1 heure."],
  "Potion of Healing (Superior)": ["Potion de soins (excellente)", "Potion, rare. Vous récupérez 8d4 + 8 points de vie quand vous buvez cette potion. Quelle que soit sa puissance, le liquide rouge de la potion scintille quand on l'agite."],
  "Antitoxin": ["Antitoxine", "Par une action bonus, vous pouvez boire une fiole d'antitoxine pour obtenir l'avantage aux jets de sauvegarde visant à éviter ou à faire cesser l'état empoisonné pendant 1 heure."],
  "Potion of Fire Giant Strength": ["Potion de force de géant du feu", "Le liquide transparent de cette potion contient un éclat d'ongle de géant du feu. Quand vous buvez cette potion, votre valeur de Force devient 25 pendant la durée indiquée. La potion n'a aucun effet sur vous si votre Force est égale ou supérieure à cette valeur."],
  "Alchemist's Fire": ["Feu grégeois", "Ce fluide collant s'enflamme au contact de l'air. Par une action, vous pouvez lancer cette fiole à la portée indiquée ; elle se brise à l'impact. Faites une attaque à distance contre une créature ou un objet, en traitant le feu grégeois comme une arme improvisée. En cas de succès, la cible subit 1d4 dégâts de feu au début de chacun de ses tours. Une créature peut mettre fin à ces dégâts en utilisant son action pour réussir un test de Dextérité DD 10 afin d'éteindre les flammes."],
  "Potion of Force Resistance": ["Potion de résistance à la force", "La potion est d'une couleur terne et indéfinissable et sent légèrement mauvais. Quand vous buvez cette potion, vous obtenez la résistance aux dégâts de force pendant la durée indiquée."],
  "Spell Scroll, Level 1": ["Parchemin de sort, niveau 1", "Un parchemin de sort (tour de magie) ou de sort (niveau 1) est un objet magique qui porte les mots d'un tour de magie ou d'un sort de niveau 1, déterminé par le créateur du parchemin. Si le sort figure sur la liste de sorts de votre classe, vous pouvez lire le parchemin et lancer le sort avec son temps d'incantation normal, sans fournir de composantes matérielles. Si le sort exige un jet de sauvegarde ou un jet d'attaque, le DD de sauvegarde du sort est 13 et le bonus d'attaque est +5. Le parchemin se désintègre une fois l'incantation terminée."],
  "Ring of Poison Resistance": ["Anneau de résistance au poison", "(Nécessite un lien d'harmonisation) Cet anneau est serti d'une améthyste qui scintille quand elle capte la lumière. Vous avez la résistance aux dégâts de poison tant que vous portez cet anneau."],
  "Belt of Cloud Giant Strength": ["Ceinture de force de géant des nuages", "Objet merveilleux (nécessite un lien d'harmonisation). Tant que vous portez cette ceinture, votre valeur de Force devient 27. Si votre Force est déjà égale ou supérieure à celle de la ceinture, l'objet n'a aucun effet sur vous."],
  "Blanket": ["Couverture", "Quand vous êtes enveloppé dans une couverture, vous avez l'avantage aux jets de sauvegarde contre le froid extrême."]
};

const src = JSON.parse(fs.readFileSync(path.join(DIR, "srd-items.json"), "utf8"));
const out = [];
for (const [en, [name, text]] of Object.entries(FR)) {
  const item = src.find((i) => i.name === en);
  if (!item) throw new Error(`Missing source item: ${en}`);
  out.push({ ...item, uuid: item.uuid, sourceName: en, name, lang: "fr", description: `<p>${text}</p>` });
}
fs.writeFileSync(path.join(DIR, "fr-items.json"), JSON.stringify(out, null, 1) + "\n");
console.log(out.length, "French items written");
