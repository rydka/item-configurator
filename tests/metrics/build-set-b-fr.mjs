// Builds fixtures/set-b/items-fr.json: 15 items of items-en.json with a hand-written French name and description.
// `truth` is copied unchanged. Run once, before any measurement: node tests/metrics/build-set-b-fr.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "set-b");
const FR = {
  "Vicious Longbow": ["Arc long vicieux", "Une épaisse tige de bois lamellé est courbée par une corde tendue capable de lancer des flèches mortelles à longue distance. Quand vous obtenez un 20 au jet d'attaque avec cette arme magique, votre coup critique inflige 2d6 dégâts supplémentaires du type de l'arme."],
  "Splint Armor of Resistance": ["Armure de plates à bandes de résistance", "(Nécessite un lien d'harmonisation) Vous avez la résistance à un type de dégâts tant que vous portez cette armure. Le MJ choisit le type ou le détermine au hasard grâce à la table des armures de résistance."],
  "Animated Shield": ["Bouclier animé", "(Nécessite un lien d'harmonisation) Tant que vous tenez ce bouclier, vous pouvez prononcer son mot de commande par une action bonus pour l'animer. Le bouclier s'élève dans les airs et flotte dans votre espace pour vous protéger comme si vous le manipuliez, ce qui laisse vos mains libres. Le bouclier reste animé pendant 1 minute, jusqu'à ce que vous utilisiez une action bonus pour y mettre fin, ou jusqu'à ce que vous soyez neutralisé ou mort ; il tombe alors au sol ou dans votre main si vous en avez une libre."],
  "Glamoured Studded Leather": ["Cuir clouté enchanté", "Tant que vous portez cette armure, vous bénéficiez d'un bonus de +1 à la CA. Vous pouvez aussi utiliser une action bonus pour prononcer le mot de commande de l'armure et lui faire prendre l'apparence d'un ensemble de vêtements normaux ou d'un autre type d'armure. Vous décidez de son aspect, y compris la couleur, le style et les accessoires, mais l'armure garde son encombrement et son poids normaux. L'apparence illusoire dure jusqu'à ce que vous utilisiez de nouveau cette propriété ou que vous retiriez l'armure."],
  "Potion of Cold Resistance": ["Potion de résistance au froid", "La potion est d'une couleur terne et indéfinissable et sent légèrement mauvais. Quand vous buvez cette potion, vous obtenez la résistance aux dégâts de froid pendant 1 heure."],
  "Potion of Cloud Giant Strength": ["Potion de force de géant des nuages", "Le liquide transparent de cette potion contient un éclat d'ongle de géant des nuages. Quand vous buvez cette potion, votre valeur de Force devient 27 pendant 1 heure. La potion n'a aucun effet sur vous si votre Force est égale ou supérieure à cette valeur."],
  "Truth Serum": ["Sérum de vérité", "Poison ingéré. Une créature soumise au sérum de vérité doit réussir un jet de sauvegarde de Constitution DD 11 sous peine d'être empoisonnée pendant 1 heure. La créature empoisonnée ne peut pas mentir sciemment."],
  "Oil of Sharpness": ["Huile d'affûtage", "Cette huile claire et gélatineuse scintille de minuscules éclats d'argent. L'huile peut enduire une arme tranchante ou perforante, ou jusqu'à 5 munitions tranchantes ou perforantes. L'application demande 1 minute. Pendant 1 heure, l'objet enduit est magique et confère un bonus de +3 aux jets d'attaque et de dégâts."],
  "Horseshoes of Speed": ["Fers à cheval de vitesse", "Objet merveilleux, rare. Ces fers à cheval vont par jeu de quatre. Par une action de Magie, vous pouvez toucher le sabot d'un cheval ou d'une créature similaire avec l'un des fers, qui se fixe alors au sabot. Retirer un fer demande aussi une action de Magie. Tant que les quatre fers sont fixés à la même créature, sa vitesse augmente de 9 mètres."],
  "Periapt of Proof against Poison": ["Périapte de protection contre le poison", "Objet merveilleux, rare (nécessite un lien d'harmonisation). Cette délicate chaîne d'argent porte un pendentif orné d'une gemme noire taillée en brillant. Tant que vous la portez, vous avez l'immunité à l'état empoisonné et aux dégâts de poison."],
  "Belt of Giant Strength (stone)": ["Ceinture de force de géant (pierre)", "Tant que vous portez cette ceinture, votre valeur de Force devient 23. Le type de géant détermine la valeur. L'objet n'a aucun effet sur vous si votre Force sans la ceinture est égale ou supérieure à 23."],
  "Eyes of Charming": ["Yeux de charme", "Objet merveilleux (nécessite un lien d'harmonisation). Ces lentilles de cristal se placent sur les yeux. Elles ont 3 charges. Tant que vous les portez, vous pouvez dépenser 1 charge par une action pour lancer le sort charme-personne (DD de sauvegarde 13) sur un humanoïde situé à 9 mètres ou moins de vous, à condition que vous et la cible puissiez vous voir. Les lentilles regagnent toutes leurs charges dépensées chaque jour à l'aube."],
  "Ring of X-ray Vision": ["Anneau de vision aux rayons X", "(Nécessite un lien d'harmonisation) Tant que vous portez cet anneau, vous pouvez utiliser une action pour prononcer son mot de commande. Vous pouvez alors voir à l'intérieur et à travers la matière solide pendant 1 minute. Cette vision a un rayon de 9 mètres. Les objets solides situés dans ce rayon vous paraissent transparents et n'empêchent pas la lumière de passer. Chaque fois que vous utilisez de nouveau l'anneau avant d'avoir pris un repos long, vous devez réussir un jet de sauvegarde de Constitution DD 15 sous peine de gagner un niveau d'épuisement."],
  "Wand of Secrets": ["Baguette des secrets", "Baguette. Cette baguette a 3 charges. Tant que vous la tenez, vous pouvez utiliser une action pour dépenser 1 charge ; si une porte secrète ou un piège se trouve à 18 mètres ou moins de vous, la baguette vibre et désigne le plus proche. La baguette regagne 1d3 charges dépensées chaque jour à l'aube."],
  "Map": ["Carte", "Si vous consultez une carte exacte, vous bénéficiez d'un bonus de +5 aux tests de Sagesse (Survie) que vous faites pour trouver votre chemin dans le lieu qu'elle représente."]
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
