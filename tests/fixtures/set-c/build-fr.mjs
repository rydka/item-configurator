// Builds items-fr.json: 20 items of items-en.json with a hand-written French name and description.
// `truth` is copied unchanged. Run once, before any measurement: node tests/fixtures/set-c/build-fr.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FR = {
  "Vicious Maul": ["Maillet vicieux", "Ce lourd maillet à deux mains broie le métal et les os avec une force de tonnerre. Quand vous obtenez un 20 au jet d'attaque avec cette arme magique, votre coup critique inflige 2d6 dégâts supplémentaires du type de l'arme."],
  "Giant Slayer Greatsword": ["Épée à deux mains tueuse de géants", "Vous bénéficiez d'un bonus de +1 aux jets d'attaque et de dégâts effectués avec cette arme magique. Quand vous touchez un géant avec elle, il subit 2d6 dégâts supplémentaires du type de l'arme et doit réussir un jet de sauvegarde de Force DD 15 sous peine de tomber à terre. Pour cette arme, « géant » désigne toute créature de type géant, y compris les ettins et les trolls."],
  "Battleaxe +3": ["Hache de bataille +3", "Que ce soit par une bénédiction démoniaque, un legs céleste, une expérience folle ou un travail d'artisan habile, cette arme a été améliorée pour répandre davantage de sang. Vous bénéficiez d'un bonus de +3 aux jets d'attaque et de dégâts effectués avec cette arme magique."],
  "Heavy Crossbow +3": ["Arbalète lourde +3", "Vous bénéficiez d'un bonus de +3 aux jets d'attaque et de dégâts effectués avec cette arme magique."],
  "Mithral Chain Shirt": ["Chemise de mailles en mithral", "Le mithral est un métal léger et souple. Une chemise de mailles ou une cuirasse en mithral peut être portée sous des vêtements ordinaires. Si l'armure impose normalement un désavantage aux tests de Dextérité (Discrétion) ou exige une certaine Force, la version en mithral ne le fait pas."],
  "Half Plate Armor +1": ["Demi-plate +1", "Vous bénéficiez d'un bonus de +1 à la CA tant que vous portez cette armure."],
  "Shield +1": ["Bouclier +1", "Tant que vous tenez ce bouclier, vous bénéficiez d'un bonus de +1 à la CA. Ce bonus s'ajoute au bonus normal du bouclier à la CA."],
  "Studded Leather Armor of Resistance": ["Armure de cuir clouté de résistance", "(Nécessite un lien d'harmonisation) Vous avez la résistance à un type de dégâts tant que vous portez cette armure. Le MJ choisit le type ou le détermine au hasard grâce à la table des armures de résistance."],
  "Potion of Longevity": ["Potion de longévité", "Potion, très rare. Quand vous buvez cette potion, votre âge physique diminue de 1d6 + 6 ans, jusqu'à un minimum de 13 ans. Chaque fois que vous buvez ensuite une potion de longévité, il y a 10 pour cent de chances cumulées que vous vieillissiez de 1d6 + 6 ans à la place. Un minuscule cœur, qui bat encore contre toute raison, flotte dans ce liquide ambré. Ces ingrédients disparaissent quand la potion est ouverte."],
  "Potion of Healing (Supreme)": ["Potion de soins (suprême)", "Potion, très rare. Vous regagnez 10d4 + 20 points de vie quand vous buvez cette potion. Quelle que soit sa puissance, le liquide rouge de la potion scintille quand on l'agite."],
  "Potion of Fire Resistance": ["Potion de résistance au feu", "La potion est d'une couleur terne et indéfinissable et sent légèrement mauvais. Quand vous buvez cette potion, vous obtenez la résistance aux dégâts de feu pendant 1 heure."],
  "Potion of Water Breathing": ["Potion de respiration aquatique", "Ce fluide vert trouble sent la mer et contient une bulle semblable à une méduse. Vous pouvez respirer sous l'eau pendant 1 heure après avoir bu cette potion."],
  "Dust of Sneezing and Choking": ["Poudre d'éternuement et d'étouffement", "Objet merveilleux. Cette poudre très fine, semblable à du sable, est conservée dans un petit récipient. Elle ressemble à de la poudre de disparition, et un sort d'identification la révèle comme telle. Il y en a assez pour une utilisation. Quand vous utilisez une action pour lancer une poignée de poudre en l'air, vous et chaque créature qui doit respirer à 9 mètres ou moins de vous devez réussir un jet de sauvegarde de Constitution DD 15 sous peine de ne plus pouvoir respirer et d'éternuer sans contrôle. Une créature ainsi affectée est neutralisée et suffoque."],
  "Belt of Giant Strength (fire)": ["Ceinture de force de géant (feu)", "Tant que vous portez cette ceinture, votre valeur de Force devient 25. Le type de géant détermine la valeur. L'objet n'a aucun effet sur vous si votre Force sans la ceinture est égale ou supérieure à 25."],
  "Bracers of Defense": ["Bracelets de défense", "Objet merveilleux (nécessite un lien d'harmonisation). Tant que vous portez ces bracelets, vous bénéficiez d'un bonus de +2 à la CA si vous ne portez aucune armure et n'utilisez aucun bouclier."],
  "Gloves of Swimming and Climbing": ["Gants de nage et d'escalade", "Objet merveilleux (nécessite un lien d'harmonisation). Tant que vous portez ces gants, grimper et nager ne vous coûte pas de déplacement supplémentaire, et vous bénéficiez d'un bonus de +5 aux tests de Force (Athlétisme) effectués pour grimper ou nager."],
  "Cape of the Mountebank": ["Cape du saltimbanque", "Objet merveilleux. Cette cape sent légèrement le soufre. Tant que vous la portez, vous pouvez l'utiliser pour lancer le sort porte dimensionnelle par une action. Cette propriété de la cape ne peut pas être utilisée de nouveau avant l'aube suivante. Quand vous disparaissez, vous laissez derrière vous un nuage de fumée, et vous apparaissez dans un nuage de fumée semblable à votre destination."],
  "Merchant's Scale": ["Balance de marchand", "Une balance comprend un petit fléau, des plateaux et un assortiment de poids adaptés jusqu'à 1 kilogramme. Avec elle, vous pouvez mesurer le poids exact de petits objets, comme des métaux précieux bruts ou des marchandises, pour aider à déterminer leur valeur."],
  "Spider's Sting": ["Dard d'araignée", "Poison par blessure. Une créature soumise au dard de Lolth doit réussir un jet de sauvegarde de Constitution DD 13 sous peine d'être empoisonnée pendant 1 heure. Si la créature rate le jet de 5 ou plus, elle est aussi inconsciente tant qu'elle est empoisonnée de cette façon. La créature se réveille si elle subit des dégâts ou si une autre créature utilise une action pour la secouer."],
  "Acid": ["Acide", "Quand vous faites l'action Attaque, vous pouvez remplacer l'une de vos attaques par le jet d'une fiole d'acide. Visez une créature ou un objet que vous voyez à 6 mètres ou moins de vous. La cible doit réussir un jet de sauvegarde de Dextérité (DD 8 plus votre modificateur de Dextérité et votre bonus de maîtrise) sous peine de subir 2d6 dégâts d'acide."]
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
