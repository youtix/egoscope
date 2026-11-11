# 02 — Taxonomie des événements

## Objet

Ce document décrit les types d'événements : ce qu'une fiche de type contient, ce qui rend un type net et datable, d'où viennent les propositions de nouveaux types, comment l'utilisateur les valide, et comment un type évolue (modification, fusion, scission, retrait) sans fausser les cas déjà mesurés. Les fiches validées sont la seule définition des types qu'emploient la détection, le prompt de recherche, l'import et les calculs. Une annexe fournit une ébauche de fiche pour chacun des types candidats du journal.

## Décisions d'origine

- D-06 — Les types doivent être nets et datables ; une IA explore le web pour en proposer, y compris des types dont les données sont plus difficiles à obtenir.
- D-12 — L'IA propose, l'utilisateur valide ; chaque type validé possède une fiche : définition, critères d'inclusion, critères d'exclusion, exemple.
- D-10 — Les sources sont des articles de presse datés et vérifiables, pour garantir que l'événement était connu avant le match.
- D-14 — Le résultat de la recherche approfondie revient en JSON strict.
- D-20 — Presse publique uniquement et stockage minimal.
- D-26 — La détection classe les articles avec un modèle de langage gratuit.
- D-08 — Pas de pari : aucun type ne peut s'y rapporter.
- D-19 — Des facteurs parasites excluent les cas douteux ; certains types y sont liés par construction.
- D-34 — Le record négatif à éviter est un type candidat.
- H-01 — Comptage exhaustif : tous les événements d'un joueur comptent.
- H-02 — Le match mesuré est le premier match joué après que l'événement est devenu public.
- H-05 — Un backtest couvre les types validés à la date de la demande ; un type validé plus tard peut donner lieu à une demande complémentaire.
- H-11 — La presse traitée est anglophone et francophone ; l'interface est en français.
- H-12 — La taxonomie fait partie du lot 1 ; la détection, qui produit une partie des propositions, du lot 2.
- Q-06 — Les événements qui touchent toute une équipe sont hors périmètre de la première version.
- Q-07 — Les autres sports sont hors périmètre de la première version.
- Types d'événements candidats du journal — aucun n'est validé ; tous doivent recevoir une fiche et être validés par l'utilisateur.

## Périmètre

Ce document couvre :
- le contenu d'une fiche de type et ce qui rend un type net et datable ;
- le cycle de vie d'un type : proposé, validé, rejeté, retiré ;
- les origines d'une proposition, dont le prompt d'exploration et son retour ;
- la validation, le rejet, la modification, la fusion, la scission, le retrait et la réactivation d'un type ;
- les effets de ces changements sur les événements et les cas existants ;
- les ébauches des types candidats, en annexe.

Il ne couvre pas :
- la façon dont la détection repère un fait sans type correspondant et le transmet : voir [04 — Détection des événements](04-detection-des-evenements.md) ;
- la création des demandes de backtest, y compris complémentaires, et le texte du prompt de recherche : voir [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) ;
- les contrôles d'un résultat de recherche à l'import : voir [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) ;
- le recalcul des profils après un changement de type : voir [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) ;
- l'envoi de la notification « proposition de nouveau type à valider » : voir [11 — Notifications Telegram](11-notifications-telegram.md) ;
- la formulation des descriptions d'événements et les sujets intimes : voir [13 — Données sensibles](13-donnees-sensibles.md).

## Acteurs et déclencheurs

- **L'utilisateur** est seul à valider, rejeter, modifier, fusionner, scinder, retirer ou réactiver un type (D-12). Il produit le prompt d'exploration, l'exécute dans une IA de recherche approfondie gratuite de son choix (D-07 bis) et en colle le retour dans l'application.
- **L'application** charge les ébauches de départ, produit le prompt d'exploration, contrôle son retour, enregistre les propositions, signale les effets d'un changement et propose les demandes complémentaires.
- **La détection quotidienne** (04, lot 2) transmet les propositions nées des articles.
- **Déclencheurs** : la première mise en service ; une action de l'utilisateur ; l'arrivée d'une proposition de la détection.

## Parcours

### Scénario nominal : valider un type candidat

1. À la première mise en service, l'application contient les types candidats du journal à l'état proposé, avec les ébauches de l'annexe (TAX-15).
2. L'utilisateur ouvre une proposition, relit l'ébauche et la complète ou la corrige.
3. S'il le souhaite, il produit un prompt d'exploration ciblé sur cette proposition, l'exécute dans une IA de recherche approfondie et colle le retour, qu'il compare à l'ébauche pour en reprendre ce qu'il veut (TAX-16, TAX-17).
4. Il demande la validation. L'application vérifie que la fiche est complète, puis présente la liste de contrôle « net et datable », que l'utilisateur confirme point par point (TAX-12).
5. Le type passe à l'état validé, en version 1. Il sert désormais aux demandes de backtest créées ensuite, à l'import et, au lot 2, à la détection (TAX-11, TAX-20).
6. Si des backtests ont déjà été importés sans couvrir ce type, l'application liste les joueurs concernés et propose pour chacun une demande complémentaire (TAX-20).

### Variantes

- **Exploration générale** : l'utilisateur produit un prompt d'exploration général, l'exécute, colle le retour ; l'application montre un aperçu des types proposés ; ceux qu'il retient deviennent des propositions (TAX-16, TAX-17).
- **Proposition venue de la détection** (lot 2) : la détection transmet un fait qui touche l'égo d'un joueur suivi sans correspondre à aucun type validé ; une proposition est créée et notifiée, ou le fait s'ajoute comme occurrence à une proposition en attente, à un type rejeté ou à un type retiré (04) ; l'utilisateur la complète, au besoin avec un prompt ciblé, puis la valide ou la rejette ; validée, ses articles sont reclassés par la détection (TAX-18, TAX-19).
- **Rejet** : l'utilisateur rejette une proposition en choisissant un motif ; il pourra la rouvrir (TAX-13, TAX-14).
- **Modification d'un type validé** : l'utilisateur modifie la fiche et qualifie la modification ; les effets dépendent de cette qualification (TAX-21 à TAX-26).
- **Fusion** ou **scission** de types validés (TAX-27 à TAX-30).
- **Retrait**, puis éventuellement **réactivation** (TAX-31, TAX-32).

## Règles de gestion

### Fiche de type

- **TAX-01** [Lot 1] — Une fiche de type comprend : un identifiant ; un nom ; une définition ; des critères d'inclusion ; des critères d'exclusion ; une règle de datation, qui dit en outre si les événements du type sont connus à l'avance, comme un anniversaire, ce dont dépend leur rattachement au match mesuré (08, SEN-02) ; un exemple générique ; des points de vigilance, dont la difficulté de documentation (facile, moyenne ou difficile) et, le cas échéant, la mention « sujet intime » pour un type qui relève des sujets intimes du document 13 (deuil, racisme subi). Les quatre éléments fixés par D-12 (définition, critères d'inclusion, critères d'exclusion, exemple), la règle de datation et la difficulté de documentation sont obligatoires pour valider ; les autres points de vigilance sont facultatifs (H-TAX-01). La fiche est rédigée en français, en phrases courtes qu'une IA peut appliquer sans interprétation.
- **TAX-02** [Lot 1] — L'identifiant d'un type est attribué à sa création. Il est court, en minuscules et sans accent, les mots séparés par des tirets, sur le modèle de ceux de l'annexe. Il ne change jamais, même quand la fiche change de version, et n'est jamais réattribué, même après un rejet ou un retrait. C'est lui que porte chaque événement d'un résultat de recherche (05), et tous les documents l'emploient tel quel, exemples compris.
- **TAX-03** [Lot 1] — L'exemple d'une fiche est générique : il ne nomme aucune personne réelle et s'écrit avec « le joueur A », « l'équipe X », « un média national » (H-TAX-02). Les exemples réels qu'une IA cite pour justifier une proposition sont conservés à part, comme sources d'illustration (lien, média, titre, date de publication), et ne servent qu'à juger la proposition.

### Ce qui rend un type net et datable

- **TAX-04** [Lot 1] — Un type est **net** quand :
  - il se reconnaît à un fait public et observable, sans supposer l'état d'esprit du joueur : l'application ne mesure pas l'égo, elle repère des faits susceptibles de le toucher ;
  - ses critères permettent de trancher par oui ou par non à la lecture d'un article, de sorte que la classification et l'utilisateur rangent le même article dans le même type ;
  - il vise nommément un joueur, et non une équipe (Q-06) ;
  - aucun fait ne peut relever à la fois de lui et d'un autre type validé (TAX-06).
- **TAX-05** [Lot 1] — Un type est **datable** quand sa règle de datation donne à chaque événement une date de référence unique, le moment où le fait devient public, établie par une source de presse datée (D-10). La règle doit permettre de situer l'événement avant ou après le coup d'envoi du match mesuré (H-02). Pour un fait qui s'étale dans le temps, elle désigne le moment qui compte, par exemple la première publication par un média national. Un type dont les événements ne peuvent pas être datés au moins au jour près n'est pas validable.
- **TAX-06** [Lot 1] — Un événement relève d'un seul type. Quand deux types sont voisins, les critères d'exclusion de chacun désignent celui qui prime. Un même incident qui comporte deux faits distincts, par exemple une moquerie puis une altercation, donne deux événements.
- **TAX-07** [Lot 1] — Aucun critère d'une fiche ne peut dépendre de ce qui s'est passé au match mesuré : ni la performance du joueur, ni sa « réponse » aux critiques, ni le résultat du match. Un type défini par son issue ne retiendrait que les belles histoires.
- **TAX-08** [Lot 1] — La difficulté de documentation dit avec quelle facilité un backtest retrouve tous les événements du type dans la presse datée, archives comprises. Un type difficile reste admis (D-06), mais sa fiche signale le risque qui lui est propre : les événements retrouvés seront surtout ceux dont on se souvient, souvent parce qu'un grand match a suivi, ce qui menace le comptage exhaustif (H-01).
- **TAX-09** [Lot 1] — Ne peuvent faire l'objet d'un type : un fait qui ne vise qu'une équipe (Q-06) ; un fait relevant de la vie privée ou de la santé du joueur (13) ; un fait propre à un autre sport (Q-07) ; toute notion liée au pari (D-08).

### Cycle de vie

- **TAX-10** [Lot 1] — Un type est dans l'un des états proposé, validé, rejeté ou retiré. Les transitions permises, toutes par l'utilisateur, sont : de proposé à validé ou à rejeté ; de rejeté à proposé (réouverture) ; de validé à retiré ; de retiré à validé (réactivation). Chaque transition est datée.
- **TAX-11** [Lot 1] — Seuls les types validés servent : prompt de recherche (05), import (06), calcul des profils (08) et, au lot 2, classification (04). Un type proposé, rejeté ou retiré n'est transmis à ces fonctions que comme élément d'une liste « à ne pas reproposer », réduite à son nom et à sa définition, que reçoivent le prompt d'exploration (TAX-16) et la classification (TAX-18). Aucune fonction ne crée un type à la volée : un identifiant inconnu dans un résultat de recherche est une erreur d'import (06).
- **TAX-12** [Lot 1] — La validation est un acte explicite de l'utilisateur (D-12) ; rien n'est validé automatiquement, pas même les ébauches de départ. Elle exige une fiche complète (TAX-01), puis la confirmation, point par point, d'une liste de contrôle (H-TAX-03) :
  - le type se reconnaît à un fait public et observable ;
  - les critères permettent de trancher par oui ou par non ;
  - aucun fait ne relève à la fois de ce type et d'un autre type validé ;
  - le fait vise nommément un joueur ;
  - aucun critère ne dépend du match mesuré ;
  - la règle de datation donne une date de référence unique, établie par une source de presse datée ;
  - la difficulté de documentation est indiquée ;
  - l'exemple ne nomme aucune personne réelle.
- **TAX-13** [Lot 1] — Le rejet exige un motif choisi dans une liste : non net, non datable, doublon d'un type existant, hors périmètre, autre ; un commentaire court est possible (H-TAX-04). Les types rejetés sont conservés avec leur motif, pour ne pas être reproposés.
- **TAX-14** [Lot 1] — L'utilisateur peut rouvrir un type rejeté, qui redevient proposé avec la fiche qu'il avait.

### Origines d'une proposition

- **TAX-15** [Lot 1] — À la première mise en service, l'application contient les neuf types candidats du journal à l'état proposé, avec l'origine « cadrage » et les ébauches de l'annexe comme contenu de départ (H-TAX-05). En fonctionnement courant, une proposition a deux origines : le prompt d'exploration (TAX-16, TAX-17) et la détection quotidienne (TAX-18). Chaque proposition garde son origine et sa date de création.
- **TAX-16** [Lot 1] — Sur demande de l'utilisateur, l'application produit un prompt d'exploration, qu'il colle dans une IA de recherche approfondie (D-06). Le prompt existe en deux modes : général, pour trouver de nouveaux types ; ciblé, pour approfondir une proposition existante ou une idée que l'utilisateur décrit en une phrase. Il contient obligatoirement :
  - le but : des types d'événements publics, individuels et datables, susceptibles de toucher l'égo d'un joueur NBA, dont on mesurera l'effet sur sa performance individuelle au match suivant ;
  - la définition de « net » et de « datable » (TAX-04, TAX-05) et l'interdiction des critères qui dépendent du match mesuré (TAX-07) ;
  - les sources admises : presse publique et datée, anglophone ou francophone (D-10, H-11, 13) ;
  - les types validés (nom et définition), puis, comme liste « à ne pas reproposer », les propositions en attente, les types rejetés avec leur motif et les types retirés ;
  - les exclusions de TAX-09 ;
  - l'invitation à inclure des types dont les données sont plus difficiles à obtenir, en le signalant (D-06) ;
  - pour chaque type proposé, les éléments attendus : nom, définition, critères d'inclusion et d'exclusion, règle de datation, exemple générique sans personne réelle, difficulté de documentation, recouvrements possibles avec les types existants, sources d'illustration publiques et datées ;
  - en mode ciblé, l'idée ou la proposition à approfondir et, pour une proposition venue de la détection, les références des articles (lien, média, titre, date), jamais leur texte ;
  - l'exigence d'une réponse rédigée en français, entièrement dans le format de TAX-17, sans texte autour.
- **TAX-17** [Lot 1] — Le retour d'exploration revient en JSON strict, comme le résultat de recherche (D-14, H-TAX-06) : une liste de types proposés portant chacun les éléments de TAX-16, décrits ici en langage courant ; leur forme exacte suit les conventions du format défini dans 05. Il porte son propre nom de format, « egoscope-exploration », distinct de « egoscope-backtest », pour que l'import d'un résultat de recherche le refuse (06, IMP-06) et que l'écran d'exploration refuse un résultat de backtest. L'utilisateur colle ce retour dans l'application, qui :
  - refuse un retour illisible ou hors format, avec un message qui dit ce qui ne va pas, sans rien créer ;
  - montre un aperçu des types proposés, en signalant les éléments manquants et les doublons possibles, c'est-à-dire un nom ou une définition proches d'un type existant, quel que soit son état ;
  - ne crée une proposition que pour les types que l'utilisateur coche ; une proposition incomplète est admise, mais ne pourra être validée qu'une fois complétée ;
  - en mode ciblé, présente le retour à côté de la proposition d'origine, et l'utilisateur choisit ce qu'il reprend ;
  - ne conserve pas le texte collé une fois les propositions créées ou l'aperçu abandonné ; jusque-là, il n'est gardé qu'en brouillon, selon le document 13 (DSN-32).
- **TAX-18** [Lot 2] — Une proposition venue de la détection porte : sa date, le joueur suivi concerné, les références des articles qui l'ont fait naître (lien, média, titre, date de publication), un nom et une définition suggérés, et la raison pour laquelle aucun type validé ne convient (04, DET-34). La classification reçoit la liste « à ne pas reproposer » (propositions en attente, types rejetés, types retirés), réduite au nom et à la définition de chacun (04, DET-14) : quand le fait correspond à l'une de ces entrées, il lui est ajouté comme nouvelle occurrence au lieu de créer une proposition. Une nouvelle proposition donne lieu à la notification « proposition de nouveau type à valider » (11) ; une occurrence ajoutée à une proposition en attente, à un type rejeté ou à un type retiré n'en donne pas, mais le nombre d'occurrences reste visible sur sa fiche. Le regroupement des propositions semblables relève de ce document (H-TAX-12) : la fiche d'une proposition signale les propositions proches, au sens des doublons possibles de TAX-17, et l'utilisateur peut y rattacher une proposition comme occurrence, ou détacher une occurrence mal rattachée pour en faire une proposition distincte. La décision prise sur une proposition est transmise à la détection, qui traite les articles liés (TAX-19).
- **TAX-19** [Lot 2] — Tant que le type est seulement proposé, l'article qui a fait naître la proposition ne crée aucun événement ; il reste « lié à une proposition » et conservé (03). La suite relève de la détection (04, DET-36, H-DET-08) : si le type est validé, les articles liés sont reclassés et peuvent créer des événements détectés datés de leur publication d'origine, ce qui respecte le comptage exhaustif (H-01) ; si la proposition est rejetée, ils deviennent non pertinents. Un cas né de ce reclassement après le coup d'envoi de son match mesuré est enregistré après le coup d'envoi et ne compte jamais comme test de l'hypothèse (10, SUI-06) : la décision de valider ne peut donc pas tirer parti du match qui a suivi (H-TAX-07).

### Effets de la validation

- **TAX-20** [Lot 1] — À la validation, la fiche reçoit la version 1 ; les modifications d'une proposition avant sa validation ne créent pas de version. Les demandes de backtest créées ensuite couvrent ce type (H-05). L'application liste les joueurs dont un backtest a déjà été importé sans couvrir ce type et propose pour chacun une demande complémentaire (05). Tant que cette demande n'est pas importée, le profil du joueur pour ce type ne repose que sur ses éventuels cas suivis, ce que le profil, la fiche joueur et la fiche d'alerte signalent par la mention « type non couvert par le backtest » (08, SEN-46 ; 01 ; 09).

### Modification d'un type validé

- **TAX-21** [Lot 1] — Seul l'utilisateur modifie une fiche validée. Toute modification est historisée : date, contenu avant et après, qualification, motif saisi.
- **TAX-22** [Lot 1] — L'utilisateur qualifie chaque modification (H-TAX-08). Une modification de la définition, des critères ou de la règle de datation lui est proposée par défaut comme de fond. Seule une modification de fond crée une nouvelle version de la fiche. Les deux qualifications sont :
  - de forme, quand la modification ne change pas les faits qui relèvent du type : nom affiché, exemple, rédaction plus claire ;
  - de fond, quand elle change ces faits ; l'utilisateur précise alors si elle élargit le type, le restreint, ou les deux à la fois.
- **TAX-23** [Lot 1] — Chaque événement garde la version de fiche sous laquelle il a été qualifié : la version en vigueur à sa détection (04), ou celle que reprenait le prompt de la demande de backtest qui l'a rapporté (05). Les prompts produits après une modification emploient la nouvelle version ; l'application signale les demandes de backtest à faire dont le prompt reprend une version antérieure, pour que l'utilisateur le régénère avant de le lancer (05).
- **TAX-24** [Lot 1] — Une modification qui élargit le type rend incomplets les backtests déjà importés : des faits désormais inclus n'y ont pas été cherchés (H-01). L'application propose une demande complémentaire pour chaque joueur concerné (05), et le profil de ces joueurs pour ce type est signalé comme incomplet jusqu'à l'import (08).
- **TAX-25** [Lot 1] — Une modification qui restreint le type fait apparaître dans la liste « à faire » ([12 — Interface et accès](12-interface-et-acces.md)), comme événements à requalifier, tous les événements qualifiés sous une version antérieure. Jusqu'à leur requalification, ils continuent de compter, et les profils du type indiquent combien de leurs cas reposent sur une version antérieure (H-TAX-09). Pour chacun, l'utilisateur choisit : conforme à la nouvelle version ; réaffecté à un autre type validé ; ou non conforme, auquel cas l'événement est effacé avec son cas, faute de type auquel le rattacher. Cet effacement suit la même portée qu'un retrait (13), mais il est compté sur la fiche de type (TAX-26) et non dans le compteur des événements retirés.
- **TAX-26** [Lot 1] — La fiche de type affiche, pour chaque version, le nombre d'événements requalifiés conformes, réaffectés et effacés, et le nombre de demandes complémentaires proposées. Ces traces restent visibles, pour que des retouches successives d'une fiche ne puissent pas faire disparaître sans bruit les cas qui dérangent. Chaque requalification déclenche le recalcul des profils concernés (08).

### Fusion et scission

- **TAX-27** [Lot 1] — Fusion : l'utilisateur choisit deux types validés ou plus et désigne celui qui subsiste. Il rédige la fiche fusionnée, qui devient une nouvelle version du type subsistant et passe par la liste de contrôle de TAX-12. Les autres types passent à l'état retiré avec le motif « fusionné dans » suivi du nom du type subsistant, et tous leurs événements sont rattachés au type subsistant. L'utilisateur indique si la fiche fusionnée couvre au moins la réunion des fiches d'origine. Si oui, les événements rattachés prennent la version issue de la fusion, et TAX-24 s'applique en outre si elle couvre davantage. Si non, les événements rattachés gardent leur version d'origine et sont à requalifier selon TAX-25. Les profils sont recalculés (08).
- **TAX-28** [Lot 1] — Après une fusion, un événement d'un résultat de recherche qui porte l'identifiant d'un type absorbé est rattaché au type subsistant, et l'aperçu d'import le signale (06, H-TAX-10).
- **TAX-29** [Lot 1] — Scission : l'utilisateur rédige les fiches de deux types ou plus issus d'un type validé et les valide dans le même acte, chacune passant par la liste de contrôle de TAX-12. Le type d'origine passe à l'état retiré avec le motif « scindé en » suivi des noms des nouveaux types. L'utilisateur répartit ensuite un à un les événements du type d'origine entre les nouveaux types, ou les efface s'ils ne relèvent d'aucun ; la liste « à faire » rappelle les événements à répartir. Tant qu'un événement n'est pas réparti, il reste rattaché au type d'origine retiré et ne compte dans aucun profil des nouveaux types. Si les nouveaux types couvrent plus que le type d'origine, TAX-24 s'applique.
- **TAX-30** [Lot 1] — Après une scission, un événement d'un résultat de recherche qui porte l'identifiant du type scindé n'est pas rattaché d'office : l'aperçu d'import demande à l'utilisateur de choisir parmi les types issus de la scission (06).

### Retrait et réactivation

- **TAX-31** [Lot 1] — Le retrait d'un type validé exige un motif et n'efface aucun événement. Le type ne sert plus à aucune des fonctions de TAX-11. Ses événements et leurs cas sont conservés, et un cas encore en attente du match continue d'être mesuré ; mais, tant que le type est retiré, ses cas ne comptent plus que dans ses profils et sa tendance générale, qui restent consultables et recalculés, présentés comme archivés (08, SEN-19), et ne nourrissent aucune fiche d'alerte ([09 — Fiche d'alerte](09-fiche-d-alerte.md)). Hors fusion et scission, un événement d'un résultat de recherche qui porte l'identifiant d'un type retiré n'est pas enregistré : l'import l'ignore avec le motif « type non validé à ce jour », même si la demande est antérieure au retrait (06, IMP-11, H-TAX-11).
- **TAX-32** [Lot 1] — La réactivation d'un type retiré repasse par la liste de contrôle de TAX-12. Ses profils et sa tendance générale cessent d'être archivés (08). Les backtests importés pendant le retrait ne l'ont pas couvert : l'application propose les demandes complémentaires comme pour une validation (TAX-20).

### Fiches transmises aux autres fonctions

- **TAX-33** [Lot 1] — Les fiches des types validés, dans leur version en vigueur, sont la seule définition des types que reçoivent le prompt de recherche (05), l'import (06), le calcul (08) et, au lot 2, la classification (04). Elles sont transmises en entier : définition, critères d'inclusion et d'exclusion, règle de datation avec l'indication « connu à l'avance », exemple.

## Données manipulées

- **Type d'événement** : identifiant ; nom ; état ; origine (cadrage, exploration, détection) ; date de création ; dates de validation, de rejet, de retrait ou de réactivation ; motif de rejet ou de retrait, avec commentaire éventuel ; liens de fusion ou de scission vers les types concernés.
- **Fiche** : définition, critères d'inclusion, critères d'exclusion, règle de datation avec l'indication « connu à l'avance », exemple générique, points de vigilance, difficulté de documentation, mention « sujet intime » le cas échéant.
- **Version de fiche** : numéro, date, contenu complet, qualification de la modification (forme ; fond qui élargit, restreint, ou les deux), motif, effets chiffrés (événements requalifiés conformes, réaffectés, effacés ; demandes complémentaires proposées).
- **Proposition venue de la détection** : occurrences, chacune avec sa date, le joueur concerné et les références des articles ; nom et définition suggérés ; raison de la non-correspondance (04).
- **Sources d'illustration** : lien, média, titre et date de publication d'exemples réels cités par l'IA ; facultatives.
- **Retour d'exploration** : texte collé par l'utilisateur, gardé en brouillon le temps de l'aperçu, effacé une fois les propositions créées ou l'aperçu abandonné (13).
- **Lien entre un événement et son type**, porté par l'événement (04, 06) : identifiant du type, numéro de la version sous laquelle il a été qualifié, et le cas échéant la mention « à requalifier » ou « à répartir ».

## Cas limites et erreurs

- **Retour d'exploration hors format** : refusé avec un message ; rien n'est créé (TAX-17).
- **Retour qui propose un type déjà validé ou rejeté** : signalé comme doublon possible dans l'aperçu ; l'utilisateur décide.
- **Exemple qui nomme une personne réelle** : l'application ne peut pas toujours le repérer ; la liste de contrôle oblige l'utilisateur à le vérifier avant de valider (TAX-12).
- **Même nouveau type proposé chaque jour par la détection** : les occurrences s'ajoutent à la proposition en attente (TAX-18), sans multiplier les notifications.
- **Modification qualifiée de forme alors qu'elle est de fond** : l'application ne peut pas le détecter ; l'historique des versions permet de le constater après coup (TAX-21).
- **Résultat collé pour une demande préparée avec une version antérieure** : la demande avait été signalée (TAX-23) ; si l'utilisateur colle quand même le résultat, les événements prennent la version de la demande et, si une modification a restreint le type depuis, rejoignent les événements à requalifier (TAX-25).
- **Deux événements du même type pour le même match mesuré**, par exemple après une fusion : ils forment un seul cas (08, SEN-05).
- **Type validé puis retiré sans aucun événement** : admis ; son identifiant n'est pas réattribué (TAX-02).
- **IA d'exploration indisponible ou quota épuisé** : ce service est employé par l'utilisateur hors de l'application ; rien ne change dans l'application, et il réessaie plus tard ou avec une autre IA gratuite.
- **Fait qui semble relever de deux types validés** : les fiches sont à corriger (TAX-06) ; en attendant, l'utilisateur choisit le type à l'import (06) ou corrige celui de l'événement détecté (04).

## Critères d'acceptation

1. (TAX-12) Étant donné une proposition sans règle de datation, quand l'utilisateur demande sa validation, alors elle est refusée et l'application indique l'élément manquant.
2. (TAX-12) Étant donné une proposition complète, quand l'utilisateur demande sa validation, alors l'application présente la liste de contrôle et ne valide le type qu'une fois chaque point confirmé.
3. (TAX-15) Étant donné une première mise en service, quand l'utilisateur ouvre la taxonomie, alors il y trouve les neuf types candidats à l'état proposé, d'origine « cadrage », et aucun type validé.
4. (TAX-11) Étant donné un type à l'état proposé, quand l'utilisateur crée une demande de backtest, alors le prompt de recherche ne contient pas ce type.
5. (TAX-02) Étant donné un type rejeté, quand une nouvelle proposition est créée, alors elle reçoit un identifiant différent, et l'identifiant du type rejeté ne sera jamais réattribué.
6. (TAX-16) Étant donné deux types validés et un type rejeté, quand l'utilisateur produit un prompt d'exploration général, alors le prompt cite les deux types validés et, dans la liste « à ne pas reproposer », le type rejeté avec son motif.
7. (TAX-17) Étant donné un retour d'exploration hors format, quand l'utilisateur le colle, alors aucune proposition n'est créée et le message dit ce qui ne va pas.
8. (TAX-17) Étant donné un retour d'exploration de trois types dont l'utilisateur coche deux, quand il confirme, alors deux propositions d'origine « exploration » sont créées à l'état proposé, et le texte collé n'est pas conservé.
9. (TAX-18) Étant donné une proposition en attente venue de la détection, quand la détection transmet un fait qui lui correspond, alors une occurrence lui est ajoutée et aucune nouvelle proposition n'est créée.
10. (TAX-19) Étant donné une proposition venue de la détection, encore à l'état proposé, dont l'article d'origine n'a créé aucun événement, quand l'utilisateur valide le type, alors l'article est reclassé par la détection et, s'il relève du nouveau type, l'événement créé est daté de la publication de cet article ; si son match mesuré a déjà commencé, le cas est enregistré après le coup d'envoi et ne compte pas comme test (04, 10).
11. (TAX-20) Étant donné trois joueurs dont le backtest a été importé, quand l'utilisateur valide un nouveau type, alors l'application propose une demande complémentaire pour chacun des trois joueurs.
12. (TAX-25) Étant donné un type validé qui compte dix événements, quand l'utilisateur enregistre une modification de fond qui le restreint, alors les dix événements apparaissent comme événements à requalifier, continuent de compter, et les profils du type signalent dix cas fondés sur une version antérieure.
13. (TAX-24) Étant donné trois joueurs dont le backtest a été importé, quand l'utilisateur enregistre une modification de fond qui élargit un type, alors l'application propose une demande complémentaire pour chacun d'eux et signale leur profil pour ce type comme incomplet.
14. (TAX-26) Étant donné une requalification qui a effacé deux événements, quand l'utilisateur ouvre la fiche du type, alors il lit, pour la version concernée, deux événements effacés.
15. (TAX-27, TAX-28) Étant donné les types T1 et T2 fusionnés dans T1, quand un résultat de recherche contient un événement portant l'identifiant de T2, alors l'import le rattache à T1 et le signale dans l'aperçu.
16. (TAX-31) Étant donné un type retiré hors fusion et hors scission, quand un résultat de recherche contient un événement de ce type, alors l'import l'ignore avec le motif « type non validé à ce jour », et les événements existants du type restent consultables.
17. (TAX-17) Étant donné un résultat de backtest, quand l'utilisateur le colle dans l'écran d'exploration, alors il est refusé avec un message qui dit que ce texte n'est pas un retour d'exploration, et aucune proposition n'est créée.

## Dépendances

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : glossaire et parcours d'ensemble.
- [01 — Joueurs suivis](01-joueurs-suivis.md) : identité du joueur, à compléter si Q-TAX-01 est tranchée en faveur du calendrier.
- [03 — Collecte des actualités](03-collecte-des-actualites.md) : conserve les articles liés à une proposition tant qu'elle attend une décision.
- [04 — Détection des événements](04-detection-des-evenements.md) : transmet les propositions venues de la détection (nom et définition suggérés, raison, articles) et les occurrences ; reçoit en entier les fiches des types validés et la liste « à ne pas reproposer » ; reçoit la décision sur une proposition et reclasse ou rend non pertinents les articles liés ; donne à chaque événement détecté la version de fiche en vigueur.
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : couvre les types validés à la date de la demande ; crée les demandes complémentaires ; signale ou régénère les prompts fondés sur une version antérieure ; fixe les conventions de format reprises par le retour d'exploration ; donne à chaque événement historique la version reprise par son prompt.
- [06 — Import des résultats de recherche](06-import-des-resultats-de-recherche.md) : refuse les identifiants inconnus et ignore ceux des types retirés ; rattache ceux des types fusionnés au type subsistant ; fait choisir le type pour ceux des types scindés ; refuse un retour d'exploration collé comme résultat de recherche.
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : recalcule les profils ; affiche les avertissements de version antérieure et de profil incomplet ; rattache au match mesuré les événements connus à l'avance (SEN-02) ; réunit en un cas deux événements du même type pour un même match (SEN-05) ; porte la question des types liés à un facteur parasite (Q-SEN-01).
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : n'emploie pas les types retirés ; signale un type non couvert par le backtest.
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : ne compte jamais comme test un cas enregistré après le coup d'envoi, notamment après le reclassement des articles d'une proposition validée (SUI-06).
- [11 — Notifications Telegram](11-notifications-telegram.md) : notifie les nouvelles propositions.
- [12 — Interface et accès](12-interface-et-acces.md) : écrans de la taxonomie et de l'exploration ; liste « à faire » (propositions, événements à requalifier, événements à répartir).
- [13 — Données sensibles](13-donnees-sensibles.md) : sujets intimes et règles de formulation, qui s'appliquent aussi aux fiches et aux exemples ; brouillon du texte collé ; discrétion des notifications pour un type marqué « sujet intime ».

## Hypothèses et questions ouvertes

Renvois au journal : D-12 et la liste des types candidats, dont aucun n'est validé ; H-05 (demandes complémentaires), qui reste à confirmer ; Q-06 (événements d'équipe), qui pèse sur le type « record négatif à éviter » ; Q-07 (autres sports).

- **H-TAX-01 — Fiche complétée (à confirmer).** Aux quatre éléments de D-12 s'ajoutent une règle de datation, qui dit si les événements sont connus à l'avance, et une difficulté de documentation, obligatoires, et des points de vigilance facultatifs, dont la mention « sujet intime » : sans règle de datation, un type n'est pas datable au sens de D-06.
- **H-TAX-02 — Exemple générique (à confirmer).** L'exemple d'une fiche ne nomme personne ; les exemples réels restent des sources d'illustration, hors de la fiche.
- **H-TAX-03 — Liste de contrôle à la validation (à confirmer).** L'utilisateur confirme point par point que le type est net et datable avant de le valider.
- **H-TAX-04 — Motifs de rejet (à confirmer).** Une liste fermée de motifs, reprise par le prompt d'exploration pour éviter les propositions déjà écartées.
- **H-TAX-05 — Chargement des types candidats (à confirmer).** Les neuf types candidats du journal sont présents dès la mise en service, à l'état proposé, avec les ébauches de l'annexe.
- **H-TAX-06 — Retour d'exploration en JSON strict (à confirmer).** Par analogie avec D-14, le retour d'exploration est structuré, porte le nom de format « egoscope-exploration » et est contrôlé avant toute création.
- **H-TAX-07 — Articles à l'origine d'une proposition (à confirmer).** La règle est celle du document 04 (DET-36, H-DET-08) : aucun événement tant que le type est proposé ; après validation, reclassement des articles liés, qui peuvent créer des événements à leur date de publication d'origine. Le garde-fou contre une validation décidée en connaissant le match est celui du document 10 : un cas enregistré après le coup d'envoi ne compte jamais comme test (SUI-06).
- **H-TAX-08 — Qualification des modifications (à confirmer).** L'utilisateur qualifie lui-même chaque modification ; une modification de la définition, des critères ou de la règle de datation est proposée comme de fond.
- **H-TAX-09 — Requalification après restriction (à confirmer).** Les événements qualifiés sous une version antérieure continuent de compter jusqu'à leur requalification ; un événement non conforme est effacé, et la fiche en garde le décompte.
- **H-TAX-10 — Identifiants des types fusionnés (à confirmer).** À l'import, l'identifiant d'un type absorbé est rattaché au type subsistant.
- **H-TAX-11 — Identifiants des types retirés (à confirmer).** Hors fusion et scission, un événement d'un type retiré n'est pas enregistré à l'import, même pour une demande antérieure au retrait : l'import l'ignore, au sens du document 06.
- **H-TAX-12 — Regroupement des propositions de la détection (à confirmer).** La classification rattache d'elle-même un fait à une entrée de la liste « à ne pas reproposer » (04) ; l'utilisateur corrige ces rattachements et regroupe les propositions proches restées distinctes, pour ne pas multiplier les propositions ni laisser un nouveau type caché sous un type rejeté.
- **Q-TAX-01 — Types connus d'avance.** L'anniversaire et le match contre l'ancienne équipe ne reposent pas sur un fait rapporté par la presse : ils se lisent dans le calendrier et dans le parcours du joueur. Faut-il les repérer comme les autres types, par la presse et la recherche approfondie, ou les déduire du calendrier ? Cette question est la seule à porter ce sujet ; elle touche plusieurs documents. Dans le second cas, l'identité du joueur ([01 — Joueurs suivis](01-joueurs-suivis.md)) devrait porter un jour anniversaire et la liste de ses anciennes équipes, la détection (04) un mécanisme qui ne part pas des articles, et le prompt de recherche (05) cesserait d'exiger une source de presse que la recherche risque de ne pas trouver pour un anniversaire peu médiatisé (Q-BKT-03). Dans les deux cas, le rattachement au match mesuré suit la règle des événements connus à l'avance (08, SEN-02), et il reste à dire ce que devient le cas quand le joueur ne joue pas ce match précis (Q-SEN-04). Sans réponse, ces types suivent la règle commune : un événement s'appuie sur une source de presse datée, au risque de ne retenir que les anniversaires et les retrouvailles que la presse a relevés.
- **Q-TAX-02 — Types liés par construction à un facteur parasite.** Renvoi : la question est portée par Q-SEN-01 ([08 — Sensibilité et verdict](08-sensibilite-et-verdict.md)), pour le record négatif à éviter, qui coïncide presque toujours avec un match à fort enjeu, facteur parasite cité par D-19. Ce document y ajoute le cas de l'approche d'un record, qui peut conduire l'équipe à orienter le jeu vers le joueur et gonfler son indice sans rapport avec l'égo. Sans réponse, la règle commune d'exclusion des cas douteux s'applique (08), au risque d'exclure la plupart des cas du record négatif à éviter.

## Annexe — Ébauches des types candidats

Les ébauches suivantes reprennent les neuf types candidats du journal. Elles sont toutes à l'état **proposé** et d'origine « cadrage » : aucune n'est validée (D-12), et l'utilisateur peut tout y changer avant de valider, sauf l'identifiant. Les identifiants ci-dessous sont attribués à ces types dès leur chargement (TAX-15, H-TAX-05) et tous les documents les emploient tels quels, exemples compris ; ils ne changent plus (TAX-02). Les valeurs chiffrées qui figurent dans une ébauche sont des propositions, à fixer dans la fiche au moment de la validation. Chaque ébauche indique ce qui la rend nette et datable, et ce qui la fragilise.

### Humiliation publique

- **Identifiant** : humiliation-publique. **Difficulté de documentation** : moyenne.
- **Définition** : un acte ou un propos public, d'un auteur identifiable, qui rabaisse ou ridiculise nommément le joueur suivi.
- **Critères d'inclusion** : l'acte ou le propos vise nommément le joueur ; il le rabaisse (moquerie, mépris, mise en doute de sa valeur ou de son statut, geste de dérision) ; son auteur est identifiable par son rôle (adversaire, entraîneur, y compris le sien, dirigeant, média, commentateur) ; il est rapporté par au moins un article de presse daté.
- **Critères d'exclusion** : une critique d'une action de jeu précise dans une analyse de match ordinaire ; un message anonyme de réseau social que la presse ne reprend pas ; une action de jeu subie, sauf si un auteur identifié s'en moque ensuite publiquement ; des propos racistes (type « racisme subi ») ; un échange hostile entre le joueur et un autre joueur (type « conflit entre joueurs ») ; une vague de critiques de plusieurs médias sans propos déclencheur unique (type « tourmente médiatique »).
- **Règle de datation** : le moment où le propos ou l'acte devient public (diffusion en direct, publication), établi par le premier article daté qui le rapporte.
- **Exemple** : la veille d'un match, l'entraîneur de l'équipe X déclare en conférence de presse que le joueur A n'a pas le niveau d'un joueur de premier plan ; un média national le rapporte le soir même ; le match mesuré est le match du joueur A le lendemain.
- **Points de vigilance** : la frontière avec la critique ordinaire est la plus délicate de la liste ; le critère « vise la valeur du joueur, pas une action précise » doit être éprouvé sur quelques articles réels avant validation.

### Racisme subi

- **Identifiant** : racisme-subi. **Difficulté de documentation** : moyenne.
- **Définition** : le joueur suivi est la cible de propos, de gestes ou de messages racistes, rapportés par la presse.
- **Critères d'inclusion** : la presse rapporte que le joueur est personnellement visé ; l'auteur est désigné par son rôle (spectateur, adversaire, personnalité, auteur de messages en ligne) ; l'incident est daté.
- **Critères d'exclusion** : un climat raciste général sans incident qui vise le joueur ; une prise de parole du joueur sur le racisme en général, sans incident le visant ; un incident qui vise un autre joueur.
- **Règle de datation** : si l'incident a eu lieu pendant un match, il est public dès ce moment, et le match mesuré est le match suivant ; sinon, la date est celle du premier article daté qui le rapporte.
- **Exemple** : pendant un match à l'extérieur, un spectateur adresse des insultes racistes au joueur A ; un média national le rapporte le lendemain ; le match mesuré est le match suivant du joueur A.
- **Points de vigilance** : mention « sujet intime » (TAX-01) ; la description suit les règles de 13 (jamais les termes employés, auteur désigné par son rôle) ; seuls les incidents que la presse a rapportés peuvent être retrouvés.

### Anniversaire du joueur

- **Identifiant** : anniversaire. **Difficulté de documentation** : facile.
- **Définition** : le joueur suivi dispute un match le jour de son anniversaire.
- **Critères d'inclusion** : un match officiel NBA du joueur a lieu le jour anniversaire de sa naissance ; un article de presse daté, publié avant le match, mentionne cet anniversaire (règle commune, tant que Q-TAX-01 n'est pas tranchée).
- **Critères d'exclusion** : un anniversaire sans match ce jour-là ; l'anniversaire d'un proche ; l'anniversaire d'un autre événement (titre, décès, record).
- **Règle de datation** : événement connu à l'avance (TAX-01) ; la date de référence est le jour anniversaire lui-même, avant le coup d'envoi, et son match mesuré est le match de ce jour (08, SEN-02).
- **Exemple** : le joueur A fête ses trente ans le jour d'un match contre l'équipe X ; plusieurs médias le mentionnent le matin.
- **Points de vigilance** : type net et datable par nature, mais dont le fait se lit dans le calendrier plutôt que dans la presse, ce qui le distingue des autres (Q-TAX-01) ; exiger un article qui mentionne l'anniversaire risque de ne retenir que les anniversaires médiatisés.

### Approche d'un record historique positif

- **Identifiant** : approche-record. **Difficulté de documentation** : facile.
- **Définition** : la presse présente le joueur suivi comme en mesure d'égaler ou de battre un record notable lors de son prochain match.
- **Critères d'inclusion** : un article daté, publié avant le match, présente le record comme atteignable à ce match ; le record est individuel (record de la ligue, record de l'histoire de son équipe, ou jalon de carrière que la presse présente comme historique).
- **Critères d'exclusion** : un record d'équipe ; un record déjà battu ; une curiosité statistique qu'aucun média ne présente avant le match ; les matchs suivants, quand le record n'est pas battu au premier match présenté comme décisif, car un record ne donne qu'un événement.
- **Règle de datation** : la première publication qui présente le record comme atteignable au prochain match.
- **Exemple** : la veille d'un match, un média national écrit que le joueur A n'est plus qu'à quelques points du record de points de l'histoire de l'équipe X.
- **Points de vigilance** : l'équipe peut orienter le jeu vers le joueur pour l'aider à battre le record, ce qui gonfle son indice de performance sans rapport avec l'égo (Q-TAX-02) ; l'événement se définit par l'approche, connue avant le match, jamais par le fait d'avoir battu le record (TAX-07).

### Record négatif à éviter

- **Identifiant** : record-negatif. **Difficulté de documentation** : facile.
- **Définition** : la presse présente le joueur suivi comme exposé, à son prochain match, à une issue ou à un record négatif notable qu'il peut encore éviter (D-34).
- **Critères d'inclusion** : un article daté, publié avant le match, présente ce match comme celui où l'issue négative peut se produire, par exemple une élimination sur un balayage après avoir été mené 3-0 dans une série, une série record de défaites ou un record personnel négatif ; l'article met en cause le joueur nommément, et pas seulement son équipe.
- **Critères d'exclusion** : une situation présentée comme celle de l'équipe sans que le joueur soit nommé (Q-06) ; un record négatif déjà subi ; une menace évoquée seulement après le match.
- **Règle de datation** : la première publication qui présente le prochain match comme celui où l'issue négative peut se produire.
- **Exemple** : l'équipe X du joueur A est menée 3-0 dans une série éliminatoire ; avant le quatrième match, un média national titre sur le risque, pour le joueur A, de subir son premier balayage en série.
- **Points de vigilance** : ce type se confond par construction avec un match à fort enjeu, facteur parasite cité par D-19 et par les limites connues ; si l'enjeu éliminatoire suffit à exclure un cas, presque tous ses cas seront exclus (Q-SEN-01, voir Q-TAX-02) ; la frontière avec un événement d'équipe (Q-06) tient tout entière au critère « le joueur est nommé ».

### Mort d'un proche

- **Identifiant** : deces-proche. **Difficulté de documentation** : moyenne.
- **Définition** : le décès d'un proche du joueur suivi est rendu public.
- **Critères d'inclusion** : la presse rapporte le décès d'un membre de la famille du joueur ou d'une personne qu'elle présente comme proche de lui ; la nouvelle est datée.
- **Critères d'exclusion** : le décès d'une personnalité sans lien personnel avec le joueur établi par la presse ; l'anniversaire d'un décès ; la maladie d'un proche (13).
- **Règle de datation** : le moment où le décès devient public, c'est-à-dire son annonce, et non la date du décès si elle est antérieure.
- **Exemple** : un média national annonce le décès d'un proche du joueur A deux jours avant un match ; le joueur A dispute ce match.
- **Points de vigilance** : mention « sujet intime » (TAX-01) ; la description ne mentionne ni nom, ni lien de parenté, ni cause (13) ; le joueur peut manquer des matchs, et son match mesuré est alors celui de son retour.

### Conflit entre joueurs

- **Identifiant** : conflit-joueurs. **Difficulté de documentation** : facile.
- **Définition** : un affrontement public, verbal ou physique, entre le joueur suivi et un autre joueur, adversaire ou coéquipier.
- **Critères d'inclusion** : le joueur est l'une des parties ; l'affrontement est public (altercation pendant un match, échange de déclarations, différend rendu public) ; il est rapporté par un article daté.
- **Critères d'exclusion** : une attaque à sens unique que le joueur subit sans répondre (type « humiliation publique ») ; les échanges verbaux ordinaires d'un match, que la presse ne présente pas comme un conflit ; un différend avec un entraîneur ou un dirigeant (type « humiliation publique » s'il rabaisse le joueur, hors type sinon).
- **Règle de datation** : le moment où le conflit devient public : pendant le match où il éclate, et le match mesuré est alors le suivant ; sinon, la première publication.
- **Exemple** : à la fin d'un match, le joueur A et un joueur de l'équipe X s'invectivent ; plusieurs médias rapportent l'échange ; le match mesuré est le match suivant du joueur A, quel que soit son adversaire.
- **Points de vigilance** : une suspension peut suivre un conflit physique, et le match mesuré est alors celui du retour ; si les deux joueurs sont suivis, le conflit donne un événement pour chacun.

### Tourmente médiatique

- **Identifiant** : tourmente-mediatique. **Difficulté de documentation** : difficile.
- **Définition** : une vague de couverture négative centrée sur le joueur suivi, déclenchée par un fait public identifiable : une déclaration, un comportement, une polémique sur son engagement.
- **Critères d'inclusion** : un fait déclencheur public et daté ; des articles critiques d'au moins trois médias distincts en deux jours (valeurs proposées, à fixer dans la fiche) ; le joueur est au centre de la couverture.
- **Critères d'exclusion** : un propos critique isolé (type « humiliation publique ») ; un conflit avec un autre joueur (type « conflit entre joueurs ») ; un incident raciste (type « racisme subi ») ; une polémique qui touche à la vie privée ou à la santé du joueur (13).
- **Règle de datation** : le moment où le seuil de couverture est atteint, c'est-à-dire la publication de l'article qui le franchit ; un même fait déclencheur ne donne qu'un événement.
- **Exemple** : après une déclaration du joueur A jugée désinvolte, trois médias nationaux publient en deux jours des articles critiques sur son engagement ; le match mesuré est le premier match du joueur A après le troisième article.
- **Points de vigilance** : type le moins net de la liste, dont la datation dépend d'un seuil à fixer ; il est difficile à reconstituer après coup, si bien qu'un backtest retrouvera surtout les tourmentes restées célèbres, souvent parce qu'une réponse marquante a suivi sur le terrain (TAX-08).

### Match contre l'ancienne équipe

- **Identifiant** : ancienne-equipe. **Difficulté de documentation** : facile.
- **Statut particulier** : proposé pendant le cadrage, ce type n'a pas été repris explicitement par l'utilisateur ; sa validation ou son rejet lui revient.
- **Définition** : le joueur suivi affronte, pour la première fois depuis son départ, une équipe NBA dont il a fait partie.
- **Critères d'inclusion** : un match officiel NBA ; le joueur a disputé au moins un match officiel pour l'équipe adverse ; c'est la première rencontre depuis son départ (variante à trancher à la validation : toutes les rencontres) ; un article de presse daté, publié avant le match, le présente comme une rencontre avec son ancienne équipe (règle commune, tant que Q-TAX-01 n'est pas tranchée).
- **Critères d'exclusion** : les matchs de présaison ou d'exhibition ; les anciennes équipes hors NBA (Q-07) ; une équipe pour laquelle il n'a disputé aucun match officiel.
- **Règle de datation** : événement connu à l'avance par le calendrier (TAX-01) ; la date de référence est le jour du match, avant le coup d'envoi, de sorte que le match mesuré est ce match lui-même (08, SEN-02).
- **Exemple** : échangé par l'équipe X pendant l'été, le joueur A la retrouve pour la première fois en novembre ; plusieurs médias présentent ce match comme ses retrouvailles avec l'équipe X.
- **Points de vigilance** : comme l'anniversaire, ce type est connu d'avance et se lit dans le calendrier plutôt que dans la presse (Q-TAX-01) ; son match mesuré est l'événement lui-même.
