// Builds fixtures/heldout/items-fr.json: 15 held-out items with a hand-written French name and description.
// `truth` is copied unchanged from items-en.json. Run once, before any measurement: node tests/metrics/build-heldout-fr.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "heldout");
const FR = {
  "Vicious Weapon": ["Arme vicieuse", "Arme (toute arme courante ou de guerre), rare. Cette arme magique inflige 2d6 dégâts supplémentaires à toute créature qu'elle touche. Ces dégâts supplémentaires sont du même type que les dégâts normaux de l'arme."],
  "Lance +1": ["Lance d'arçon +1", "Que ce soit par une bénédiction démoniaque, un legs céleste, une expérience insensée ou un savoir-faire exceptionnel, cette arme a été améliorée pour semer plus de sang entre les mains de son porteur. Vous obtenez un bonus aux jets d'attaque et de dégâts effectués avec cette arme magique. Spécial. Vous avez un désavantage quand vous attaquez avec une lance d'arçon une cible située à 1,50 mètre ou moins de vous. De plus, une lance d'arçon nécessite deux mains quand vous n'êtes pas monté."],
  "Potion of Giant Strength (Frost)": ["Potion de force de géant (givre)", "Potion, rare. Quand vous buvez cette potion, votre valeur de Force devient 23 pendant 1 heure. Le type de géant détermine la valeur. La potion n'a aucun effet sur vous si votre Force est égale ou supérieure à cette valeur. Le liquide transparent de cette potion contient un éclat de lumière semblable à l'ongle d'un géant."],
  "Poison, Basic": ["Poison de base", "Par une action bonus, vous pouvez utiliser une fiole de poison de base pour enduire une arme ou jusqu'à trois munitions. Une créature qui subit des dégâts perforants ou tranchants de l'arme ou de la munition empoisonnée subit 1d4 dégâts de poison supplémentaires. Une fois appliqué, le poison reste actif pendant 1 minute ou jusqu'à ce que ses dégâts soient infligés, selon ce qui survient en premier."],
  "Potion of Gaseous Form": ["Potion de forme gazeuse", "Le récipient de cette potion semble contenir un brouillard qui se meut et se verse comme de l'eau. Quand vous buvez cette potion, vous bénéficiez de l'effet du sort forme gazeuse pendant 1 heure (sans concentration) ou jusqu'à ce que vous y mettiez fin par une action bonus."],
  "Potion of Poison Resistance": ["Potion de résistance au poison", "La potion est d'une couleur terne et indéfinissable et sent légèrement mauvais. Quand vous buvez cette potion, vous obtenez la résistance aux dégâts de poison pendant 1 heure."],
  "Boots of Elvenkind": ["Bottes elfiques", "Objet merveilleux, peu commun. Tant que vous portez ces bottes, vos pas ne font aucun bruit, quelle que soit la surface sur laquelle vous vous déplacez. Vous avez également l'avantage aux tests de Dextérité (Discrétion)."],
  "Belt of Giant Strength (hill)": ["Ceinture de force de géant (colline)", "Tant que vous portez cette ceinture, votre valeur de Force devient 21. Le type de géant détermine la valeur. L'objet n'a aucun effet sur vous si votre Force sans la ceinture est égale ou supérieure à 21."],
  "Periapt of Health": ["Périapte de santé", "Objet merveilleux, peu commun (nécessite un lien d'harmonisation). Tant que vous portez ce pendentif, vous pouvez utiliser une action de Magie pour récupérer 2d4 + 2 points de vie. Une fois utilisée, cette propriété ne peut plus l'être avant l'aube suivante. De plus, vous avez l'avantage aux jets de sauvegarde visant à éviter ou à faire cesser l'état empoisonné tant que vous portez ce pendentif."],
  "Ring of Warmth": ["Anneau de chaleur", "(Nécessite un lien d'harmonisation) Tant que vous portez cet anneau, vous avez la résistance aux dégâts de froid. De plus, vous et tout ce que vous portez êtes indemnes des températures aussi basses que -45 degrés Celsius."],
  "Cloak of the Manta Ray": ["Cape de la raie manta", "Objet merveilleux. Tant que vous portez cette cape avec la capuche relevée, vous pouvez respirer sous l'eau et vous avez une vitesse de nage de 18 mètres. Relever ou abaisser la capuche demande une action."],
  "Wand of the War Mage +1": ["Baguette du mage de guerre +1", "Baguette (nécessite un lien d'harmonisation avec un lanceur de sorts). Tant que vous tenez cette baguette, vous bénéficiez d'un bonus de +1 aux jets d'attaque de sort. De plus, vous ignorez le abri partiel quand vous effectuez une attaque de sort."],
  "Ring of Acid Resistance": ["Anneau de résistance à l'acide", "(Nécessite un lien d'harmonisation) Cet anneau est incrusté d'une perle qui miroite quand elle capte la lumière. Vous avez la résistance aux dégâts d'acide tant que vous portez cet anneau."],
  "Elemental Gem (Emerald)": ["Gemme élémentaire (émeraude)", "Cette gemme contient une parcelle d'énergie élémentaire. Quand vous utilisez une action Utiliser pour briser la gemme, un élémentaire de l'eau est invoqué et la gemme cesse d'être magique. L'élémentaire apparaît dans un espace inoccupé aussi proche que possible de la gemme brisée, comprend vos langues, obéit à vos ordres et joue son tour juste après le vôtre. L'élémentaire disparaît après 1 heure, quand il meurt ou quand vous le renvoyez par une action bonus."],
  "Magnifying Glass": ["Loupe", "Cette lentille permet d'observer de plus près les petits objets. Elle sert aussi de substitut au briquet à silex pour allumer des feux. Allumer un feu avec une loupe nécessite une lumière aussi vive que celle du soleil pour la concentrer, de l'amadou et environ 5 minutes. Une loupe confère l'avantage à tout test de caractéristique effectué pour évaluer ou inspecter un objet petit ou très détaillé."]
};

const src = JSON.parse(fs.readFileSync(path.join(DIR, "items-en.json"), "utf8"));
const out = [];
for (const [en, [name, text]] of Object.entries(FR)) {
  const item = src.find((i) => i.name === en);
  if (!item) throw new Error(`Missing source item: ${en}`);
  out.push({ ...item, sourceName: en, name, lang: "fr", description: `<p>${text}</p>` });
}
fs.writeFileSync(path.join(DIR, "items-fr.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(out.length, "French items written");
