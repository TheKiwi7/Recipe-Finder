// Dictionnaire de départ : ingrédient de base ← variantes rencontrées dans les recettes.
// Format : "base: variante | variante". La base elle-même est toujours reconnue.
// La base « - » marque des termes à ignorer (ustensiles glissés dans la liste d'ingrédients…).
// Les termes absents d'ici sont envoyés à Claude par lots (voir normalize-unknown.ts).
const SEED = `
ail: gousse d ail | ail en poudre | ail semoule
oignon: oignon jaune | oignon rouge | oignon blanc | oignon nouveau
échalote: echalotte
ciboulette:
persil: persil plat | persil frisé
basilic:
coriandre:
menthe:
thym:
romarin:
laurier: feuille de laurier
herbes de Provence:
estragon:
aneth:
sauge:
origan:
gingembre:
citronnelle:
sel: sel fin | gros sel | fleur de sel
poivre: poivre noir | poivre du moulin | poivre blanc
piment: piment d espelette | piment de cayenne | poivre de cayenne | piment rouge | piment vert | piment en poudre
paprika: paprika fumé
cumin:
curry: curry en poudre | pâte de curry
curcuma:
cannelle:
muscade: noix de muscade
vanille: gousse de vanille | sucre vanillé | extrait de vanille | arôme vanille
cacao: cacao en poudre | cacao amer
huile: huile neutre | huile de tournesol | huile de colza | huile végétale | huile de friture | huile de pépins de raisin
huile d'olive:
huile de sésame:
vinaigre: vinaigre de vin | vinaigre balsamique | vinaigre de cidre | vinaigre blanc | vinaigre de xérès
moutarde: moutarde à l ancienne | moutarde de dijon
sauce soja:
ketchup:
mayonnaise:
miel:
sirop d'érable:
sucre: sucre en poudre | sucre blanc | sucre roux | sucre de canne | cassonade | vergeoise | sucre semoule
fleur d'oranger: eau de fleur d oranger
sucre glace:
farine: farine de blé | farine t45 | farine t55 | farine t65
maïzena: fécule de maïs | maizena
levure chimique: sachet de levure | levure
levure de boulanger: levure boulangère | levure fraîche
bicarbonate:
chapelure:
eau: eau froide | eau chaude | eau tiède | eau bouillante
bouillon: cube de bouillon | bouillon de volaille | bouillon de légumes | bouillon de boeuf | fond de veau | bouillon cube | bouillon de poule | fond de volaille
vin blanc:
vin rouge:
bière:
lait: lait entier | lait demi écrémé | lait écrémé
lait de coco:
lait végétal: lait de soja | lait d amande | lait d avoine | lait de riz | boisson végétale
crème fraîche: crème | crème fraîche épaisse | crème épaisse | crème liquide | crème entière | crème fleurette | crème fraîche liquide | crème légère
beurre: beurre doux | beurre demi sel | beurre salé | beurre mou | beurre fondu | noix de beurre | noisette de beurre
oeuf: jaune d oeuf | blanc d oeuf
yaourt: yaourt nature | yaourt grec
fromage blanc:
mascarpone:
ricotta:
mozzarella: boule de mozzarella
parmesan: parmigiano
gruyère: gruyère râpé | emmental | emmental râpé | fromage râpé | comté
chèvre: fromage de chèvre | bûche de chèvre | buche de chevre | chèvre frais
roquefort: bleu | gorgonzola
feta:
reblochon:
camembert:
raclette: fromage à raclette
cheddar:
pâte feuilletée: rouleau de pâte feuilletée | pâtes feuilletées
pâte brisée: rouleau de pâte brisée | pâtes brisées
pâte sablée: pâtes sablées
pâte à pizza:
riz: riz basmati | riz rond | riz long | riz thaï | riz arborio | riz à risotto
pâtes: spaghetti | tagliatelle | penne | coquillette | fusilli | farfalle | linguine | conchiglie | macaroni | lasagne | feuille de lasagne
semoule: couscous
quinoa:
lentilles: lentille | lentille verte | lentille corail
pois chiches: pois chiche
haricots rouges: haricot rouge
haricots blancs: haricot blanc
pain: baguette | pain de mie | tranche de pain | pain rassis | pain complet
tortilla: tortilla de blé | wrap
croûtons: croûton
pomme de terre: patate
patate douce:
carotte:
courgette:
aubergine:
poivron: poivron rouge | poivron vert | poivron jaune
tomate: tomate cerise | tomate grappe | tomate pelée | tomate concassée
concentré de tomate: double concentré de tomate | purée de tomate
coulis de tomate: sauce tomate | passata
champignon: champignon de paris | champignons de paris | champignon de couche
poireau:
épinard: pousse d épinard
salade: laitue | mâche | roquette | mesclun | batavia | feuille de salade
concombre:
brocoli:
chou-fleur: chou fleur
chou: chou vert | chou rouge | chou blanc
chou de Bruxelles:
céleri: branche de céleri | céleri rave
fenouil:
navet:
betterave:
radis:
petits pois: petit pois
haricots verts: haricot vert
maïs: mais en conserve
avocat:
potiron: courge | butternut | potimarron | citrouille
artichaut: fond d artichaut | coeur d artichaut
asperge:
olive: olive noire | olive verte
câpres: câpre
cornichons:
citron: jus de citron | zeste de citron | citron jaune
citron vert: lime
orange: jus d orange | zeste d orange
pomme:
poire:
banane:
fraise:
framboise:
myrtille:
cerise:
pêche:
abricot:
ananas:
mangue:
raisin sec: raisins secs
noix de coco: coco râpée | noix de coco râpée
amande: amande en poudre | poudre d amande | amande effilée
noisette: poudre de noisette
noix: cerneau de noix
noix de cajou:
noix de pécan: noix de pecan
pignons de pin: pignon de pin | pignon
cacahuète: cacahouète
chocolat: chocolat noir | chocolat pâtissier | chocolat au lait | chocolat blanc | pépite de chocolat | chocolat à cuire
confiture:
pâte à tartiner: nutella | pâtes à tartiner | chocolat à tartiner
poulet: blanc de poulet | escalope de poulet | cuisse de poulet | filet de poulet | aile de poulet | pilon de poulet
dinde: escalope de dinde | blanc de dinde
canard: magret de canard | cuisse de canard
boeuf: viande de boeuf | steak | bourguignon | rôti de boeuf | bavette | entrecôte | paleron
boeuf haché: viande hachée | steak haché | haché de boeuf
veau: escalope de veau | blanquette de veau | rôti de veau
porc: filet mignon | côte de porc | échine de porc | rôti de porc | sauté de porc
agneau: gigot d agneau | épaule d agneau | côtelette d agneau
lardons: lardon | lardon fumé | poitrine fumée
jambon: jambon blanc | tranche de jambon | jambon cuit
jambon cru: jambon de bayonne | jambon de parme | prosciutto
chorizo:
saucisse: chipolata | merguez | saucisse de toulouse | saucisse de strasbourg
bacon:
saumon: pavé de saumon | filet de saumon | saumon frais
saumon fumé:
thon: thon en boîte | thon au naturel | miette de thon
cabillaud: dos de cabillaud | filet de cabillaud | colin | lieu | merlu | églefin
dorade: daurade | dorade grise | dorade royale
crevette: crevette décortiquée | gambas
moule:
couteaux: couteau | couteau de mer
saint-jacques: noix de saint jacques | coquille saint jacques | saint jacques
sardine:
surimi:
tofu:
-: moule à | moules à | papier sulfurisé | papier cuisson | film alimentaire | pique en bois | cure dent | décoration
`;

export function seedAliases(): Array<[alias: string, base: string | null]> {
  const pairs: Array<[string, string | null]> = [];
  for (const line of SEED.trim().split('\n')) {
    const [base, rest = ''] = line.split(/:(.*)/s);
    const b = base.trim() === '-' ? null : base.trim();
    if (b) pairs.push([b, b]);
    for (const alias of rest.split('|').map(s => s.trim()).filter(Boolean)) pairs.push([alias, b]);
  }
  return pairs;
}
