# 03 — Collecte des actualités

## Objet

La collecte rassemble chaque jour, sans intervention de l'utilisateur, les articles publiés par les sources de presse sportive qu'il a choisies, afin que la détection puisse y repérer des événements ([04 — Détection des événements](04-detection-des-evenements.md)). Elle ne conserve de chaque article que le strict nécessaire et elle le date avec prudence : l'instant de publication est ce qui permettra d'établir qu'un événement était connu avant un match. Elle surveille les sources, rattrape les interruptions quand c'est encore possible et rend compte de chaque exécution dans un journal consultable.

## Décisions d'origine

Source : [90 — Journal des décisions](90-journal-des-decisions.md).

- D-05 — Résultat chiffré et sourcé : les articles rattachés à un événement en sont les sources et doivent rester consultables.
- D-07 bis — Gratuité totale : les sources sont gratuites et lues sans abonnement.
- D-10 — Presse sportive et archives d'actualités : des sources datées et vérifiables, pour garantir qu'un événement était connu avant le match.
- D-15 — Le balayage des nouveaux événements est planifié et quotidien.
- D-20 — Presse publique uniquement, stockage minimal, aucun détail intime.
- D-26 — Des flux d'actualités sont collectés par une tâche planifiée, puis classés par un modèle de langage.
- H-01 — Comptage exhaustif : une interruption de collecte peut faire manquer des événements ; elle doit donc rester visible.
- H-02 — Un événement publié après le coup d'envoi ne compte pas pour ce match : l'heure de publication est décisive.
- H-11 — La collecte traite l'anglais et le français.
- H-12 — La collecte appartient au lot 2.

## Périmètre

La collecte couvre :

- le choix et la gestion des sources par l'utilisateur : ajout avec essai préalable, modification, désactivation, réactivation, retrait ;
- l'exécution quotidienne planifiée, l'exécution à la demande et le rattrapage après une interruption ;
- la lecture des flux, le contrôle de la langue, la datation de chaque article et le dédoublonnage ;
- ce qui est conservé d'un article et pendant combien de temps ;
- la surveillance des sources (flux en panne, flux muet) et le journal de collecte.

Elle ne couvre pas :

- la recherche des joueurs suivis dans les articles, la classification, le regroupement des articles par événement et la date de référence d'un événement : [04 — Détection des événements](04-detection-des-evenements.md) ;
- les règles générales sur les données sensibles et ce qui ne doit jamais être stocké : [13 — Données sensibles](13-donnees-sensibles.md) ;
- le contenu et le moment des messages d'incident : [11 — Notifications Telegram](11-notifications-telegram.md) ;
- la présentation des écrans (liste des sources, essai d'une source, journal) : [12 — Interface et accès](12-interface-et-acces.md) ;
- les règles communes aux tâches planifiées, aux journaux, aux quotas, aux réglages et aux fuseaux horaires : [14 — Exigences transverses](14-exigences-transverses.md) ;
- la recherche d'événements passés dans les archives d'actualités, confiée à la recherche approfondie : [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md).

## Acteurs et déclencheurs

- **L'utilisateur** gère les sources, consulte le journal de collecte et peut lancer une collecte à la demande.
- **La tâche planifiée de collecte** déclenche l'exécution quotidienne (D-15).
- **Les flux d'actualités** sont des services externes publics, lus sans identification.
- **La détection** (document 04) reçoit les nouveaux articles, puis fait évoluer leur état de traitement.
- **La tâche de purge** (document 14) supprime les articles arrivés au terme de leur conservation.

## Parcours

### Scénario nominal : exécution quotidienne

1. À l'heure prévue, la tâche de collecte démarre et ouvre une entrée dans le journal de collecte.
2. L'application lit le flux de chaque source active.
3. Pour chaque élément du flux, elle contrôle qu'il est complet et rédigé en anglais ou en français, détermine son instant de publication retenu et la précision de cet instant, ignore les éléments trop anciens, puis vérifie qu'il ne s'agit pas d'un article déjà connu.
4. Elle enregistre chaque nouvel article à l'état « à analyser ».
5. Elle met à jour l'état de santé de chaque source, l'instant de sa dernière lecture réussie et, le cas échéant, les trous de collecte constatés.
6. Elle clôt l'entrée du journal avec les compteurs de l'exécution et transmet les nouveaux articles à la détection.

### Variante A : ajout d'une source

1. L'utilisateur saisit l'adresse d'un flux.
2. L'application lit ce flux à titre d'essai, sans rien enregistrer, et présente un aperçu : nombre d'éléments, derniers titres avec l'instant de publication tel qu'il serait retenu, langue déclarée, part des éléments datés de façon exacte.
3. L'utilisateur indique le nom du média, la langue de la source et, s'il le connaît, le fuseau horaire du média ; il atteste qu'il s'agit de presse sportive publique.
4. La source est enregistrée, active, à l'état de santé « jamais lue ». Elle sera lue à la prochaine exécution, ou aussitôt si l'utilisateur lance une collecte à la demande.

### Variante B : désactivation, réactivation, retrait

1. L'utilisateur désactive une source : elle n'est plus lue, mais reste dans la liste et peut être réactivée.
2. À la réactivation, la source est lue normalement à l'exécution suivante ; la période de désactivation n'est pas rattrapée.
3. L'utilisateur retire une source : elle n'est plus lue et disparaît de la liste des sources en service ; les articles déjà rattachés à un événement restent consultables.

### Variante C : collecte à la demande

L'utilisateur lance une collecte depuis l'interface. Elle suit exactement les règles d'une exécution planifiée, est marquée « à la demande » dans le journal et ne supprime pas l'exécution planifiée suivante.

### Variante D : rattrapage après une interruption

1. Au début d'une exécution, l'application constate que la dernière lecture réussie d'une source est plus ancienne que l'ancienneté maximale admise.
2. Pour cette source, elle allonge l'ancienneté admise de la durée écoulée depuis cette dernière lecture réussie et recueille tout ce que le flux propose encore.
3. Si l'élément le plus ancien proposé par le flux a été publié après la dernière lecture réussie, la période intermédiaire est enregistrée comme trou de collecte possible.

### Variante E : flux en panne ou muet

1. La lecture d'un flux échoue malgré plusieurs tentatives, ou réussit sans apporter aucun article nouveau depuis plusieurs jours.
2. Au-delà des seuils prévus, la source passe à l'état « en panne » ou « muette », et un incident ou un avertissement est ouvert.
3. Dès qu'une lecture apporte de nouveau des articles, la source redevient « fonctionnelle », l'incident ou l'avertissement est clos et la durée de l'interruption est consignée.

## Règles de gestion

### Sources

- **COL-01** [Lot 2] — L'application ne lit que les sources inscrites par l'utilisateur. Elle n'est livrée avec aucune source préinstallée (voir Q-COL-02).
- **COL-02** [Lot 2] — Une source est un flux d'actualités public, dans un format de syndication standard, lisible sans identification, sans abonnement et sans frais ; l'application n'en contourne jamais les restrictions d'accès (D-07 bis, D-20 ; règles générales au document 13, DSN-02). Un flux qui exige une identification est refusé à l'ajout, avec un message qui en donne la raison.
- **COL-03** [Lot 2] — Une source relève de la presse sportive publique (D-10, D-20). L'application ne pouvant pas le vérifier seule, l'utilisateur l'atteste à l'ajout ; la liste des sources rappelle cette règle.
- **COL-04** [Lot 2] — Une source doit être datée (D-10). L'ajout est refusé si aucun élément du flux d'essai ne porte de date de publication ni de date de mise à jour. Si les éléments portent une date sans heure, ou une heure sans fuseau alors que l'utilisateur ne connaît pas le fuseau du média, l'ajout est accepté avec un avertissement explicite : les articles de cette source permettront rarement d'établir qu'un événement était connu avant un match (H-COL-05).
- **COL-05** [Lot 2] — La langue d'une source est l'anglais ou le français (H-11). Aucune autre langue ne peut être choisie.
- **COL-06** [Lot 2] — Un flux qui regroupe des articles de plusieurs médias (agrégateur) est admis. Le média retenu pour chaque article est son média d'origine quand le flux l'indique, sinon le nom de la source (H-COL-06).
- **COL-07** [Lot 2] — L'ajout d'une adresse déjà inscrite pour une source active ou désactivée est refusé, avec l'indication de la source existante.
- **COL-08** [Lot 2] — L'utilisateur peut modifier le nom, la langue, le fuseau et le délai de silence d'une source. Une modification de l'adresse déclenche un nouvel essai (variante A, étape 2) avant d'être enregistrée. Les articles déjà collectés ne sont pas modifiés.
- **COL-09** [Lot 2] — Une source désactivée n'est plus lue ; ses articles conservent leur état et leur durée de conservation. À la réactivation, la période de désactivation n'est pas rattrapée et le journal la mentionne comme « période non collectée (source désactivée) ».
- **COL-10** [Lot 2] — Une source retirée n'est plus lue et ne peut plus être réactivée ; l'utilisateur peut l'inscrire de nouveau comme une nouvelle source. Les articles rattachés à un événement restent conservés avec le nom de leur média (D-05) ; les autres suivent les règles de conservation ordinaires.
- **COL-11** [Lot 2] — Pour chaque source, l'application affiche sur une période glissante paramétrable (par défaut 30 jours, H-COL-04) : le nombre moyen d'articles nouveaux par jour, la part d'articles retenus par le préfiltrage du document 04, la part d'articles rattachés à un événement, la part d'articles datés de façon exacte, l'instant de la dernière lecture réussie et l'état de santé. Ces indicateurs aident l'utilisateur à juger l'utilité d'une source et ce qu'elle consomme du quota du modèle (D-07 bis).

### Exécution

- **COL-12** [Lot 2] — La collecte s'exécute automatiquement chaque jour (D-15, D-26), à une heure paramétrable exprimée dans le fuseau de l'utilisateur (réglage du document 12, IHM-14), par défaut 22 h, heure de Paris (H-COL-01). Le paramètre admet plusieurs heures par jour ; une seule est prévue par défaut. Cette heure prend place dans le calendrier d'ensemble des tâches (document 14, TRV-25) ; elle fixe la part des cas suivis enregistrés avant le coup d'envoi (Q-SUI-02 du document 10).
- **COL-13** [Lot 2] — Chaque exécution lit chaque source active une fois. En cas d'échec, la lecture est retentée au cours de la même exécution, jusqu'à un nombre de tentatives paramétrable (par défaut 3, H-COL-04).
- **COL-14** [Lot 2] — L'utilisateur peut lancer une collecte à la demande (variante C). Une collecte ne démarre pas tant qu'une autre est en cours : la demande est alors différée et l'utilisateur en est informé.
- **COL-15** [Lot 2] — Une collecte lancée deux fois, ou interrompue puis reprise, ne crée jamais de doublon et ne perd aucun article (règles communes du document 14).
- **COL-16** [Lot 2] — À la fin de chaque exécution, les nouveaux articles sont transmis à la détection, qui s'enchaîne sans attendre (D-26).

### Lecture et datation

- **COL-17** [Lot 2] — La langue d'un article est celle que déclare l'élément du flux, sinon celle de la source. Un élément rédigé dans une autre langue que l'anglais ou le français n'est pas enregistré ; il est seulement compté dans le journal.
- **COL-18** [Lot 2] — Un élément sans lien ou sans titre n'est pas enregistré, car il ne serait ni vérifiable ni exploitable (D-10) ; il est compté dans le journal comme « incomplet ».
- **COL-19** [Lot 2] — Chaque article reçoit un **instant de publication retenu**, enregistré comme un instant absolu (document 14). Il provient de la date de publication indiquée par le flux ; si le flux n'indique qu'une date de mise à jour, c'est elle qui sert, puisqu'elle ne peut pas précéder la publication.
- **COL-20** [Lot 2] — L'instant retenu porte une **précision** : « exacte » quand la date, l'heure et le fuseau sont connus, le fuseau pouvant venir de l'élément ou, à défaut, du fuseau du média déclaré pour la source ; « approximative » quand il manque l'heure, ou le fuseau sans que celui du média soit connu ; « absente » quand l'élément ne porte aucune date.
- **COL-21** [Lot 2] — **Principe de prudence** (D-10, H-02) : en cas de doute, l'instant retenu est le plus tardif compatible avec ce que le flux indique, de sorte que l'application ne conclue jamais à tort qu'un article était public avant un match. Pour une date sans heure, c'est la fin de cette journée dans le fuseau du média s'il est connu, sinon dans le fuseau où cette journée se termine le plus tard ; pour une heure sans fuseau, lorsque le fuseau du média n'est pas connu, c'est cette heure dans le fuseau où elle survient le plus tard ; sans aucune date, c'est l'instant de première collecte (H-COL-05).
- **COL-22** [Lot 2] — L'**instant de première collecte** est toujours enregistré. C'est une borne sûre : l'article était public au plus tard à cet instant, et l'instant retenu ne lui est jamais postérieur. Si le flux annonce une publication postérieure à cet instant, l'instant de première collecte est retenu, la précision devient « approximative » et l'anomalie est comptée dans le journal.
- **COL-23** [Lot 2] — L'instant retenu d'un article est fixé à sa première collecte. Une lecture ultérieure du flux qui annoncerait un autre titre ou une autre date pour le même article ne le modifie pas. La date de référence d'un événement, calculée à partir des instants retenus de ses articles, relève du document 04.
- **COL-24** [Lot 2] — Un élément dont l'instant retenu est plus ancien que l'ancienneté maximale (paramétrable, par défaut 3 jours, H-COL-02) n'est pas enregistré, sauf rattrapage (COL-45) ; il est compté dans le journal. Cette règle s'applique aussi à la première lecture d'une nouvelle source, afin de ne pas faire classer ses archives.

### Contenu conservé

- **COL-25** [Lot 2] — D'un article, l'application ne conserve que : le titre, le nom du média, le lien, l'instant de publication retenu et sa précision, l'instant de première collecte, la langue, la ou les sources où il a été vu et un court extrait fourni par le flux (D-20). Elle ne conserve ni le texte intégral, ni l'auteur, ni les images, ni les rubriques.
- **COL-26** [Lot 2] — L'application ne consulte jamais la page de l'article : elle se limite à ce que le flux fournit (H-COL-03).
- **COL-27** [Lot 2] — L'extrait est débarrassé de toute mise en forme et tronqué à une longueur paramétrable (par défaut 500 caractères, H-COL-03). Si le flux n'en fournit pas, seul le titre est conservé.
- **COL-28** [Lot 2] — Le lien conservé est débarrassé des éléments de suivi publicitaire qui ne changent pas l'article désigné ; c'est ce lien qui sert au dédoublonnage et qui est montré à l'utilisateur.
- **COL-29** [Lot 2] — Les règles du document 13 priment : un élément qu'elles interdisent de conserver ne l'est pas, ou est effacé dès qu'elles l'exigent.

### Dédoublonnage

- **COL-30** [Lot 2] — Un article déjà connu n'est pas enregistré une seconde fois. Deux éléments désignent le même article s'ils ont le même lien, ou le même identifiant fourni par le même flux, ou encore le même média et le même titre (sans tenir compte de la casse, des accents ni de la ponctuation) avec des instants retenus distants de moins de 6 heures (paramétrable, H-COL-02).
- **COL-31** [Lot 2] — Un même article vu par plusieurs sources (par exemple le flux d'un média et un agrégateur) n'est enregistré qu'une fois ; les autres sources où il a été vu lui sont ajoutées, sans changer son instant retenu.
- **COL-32** [Lot 2] — Le dédoublonnage de la collecte ne concerne que le même article. Des articles distincts qui rapportent le même fait, y compris une même dépêche reprise par plusieurs médias, sont tous conservés ; leur regroupement en un seul événement relève du document 04.
- **COL-33** [Lot 2] — Le dédoublonnage a lieu avant toute transmission à la détection, pour qu'aucun article ne consomme deux fois le quota du modèle (D-07 bis).
- **COL-34** [Lot 2] — Lorsqu'un article est supprimé, hors effacement lié au retrait d'un événement (COL-37), une **trace de dédoublonnage**, réduite à son lien et à son instant de première collecte, est conservée pendant une durée paramétrable (par défaut 180 jours, H-COL-04), pour qu'un article encore présent dans un flux ne soit pas traité de nouveau.

### Conservation

- **COL-35** [Lot 2] — Un article porte un état de traitement, que la détection fait évoluer (document 04) : « à analyser », « en attente de classification », « non pertinent », « rattaché » (à au moins un événement, détecté ou écarté) ou « lié à une proposition » (proposition de type d'événement en attente de décision, document 02).
- **COL-36** [Lot 2] — Un article « non pertinent » est supprimé, à l'exception de sa trace de dédoublonnage, au terme d'une durée paramétrable comptée depuis sa première collecte ou, s'il a d'abord attendu (COL-38), depuis qu'il est devenu non pertinent (par défaut 30 jours, H-COL-04). Jusque-là, l'utilisateur peut le consulter et le repêcher (document 04).
- **COL-37** [Lot 2] — Un article « rattaché » est conservé aussi longtemps que l'événement auquel il est rattaché. Son extrait est toutefois effacé au terme de la durée fixée par la règle COL-36 : le titre, le média, le lien et les instants suffisent ensuite à sourcer l'événement (D-20, H-COL-03). S'il n'est plus rattaché à aucun événement, par exemple après une correction, il suit la règle de l'article non pertinent. Quand un événement est retiré (document 13, DSN-27, DSN-34), ses articles qui ne sont rattachés à aucun autre événement sont effacés aussitôt, avec leurs résultats de classification et sans trace de dédoublonnage, puisque leur lien suffirait à désigner l'événement retiré (voir Q-DSN-01 du document 13). L'écartement d'un événement (document 04), lui, ne change rien à ses articles.
- **COL-38** [Lot 2] — Un article « à analyser », « en attente de classification » ou « lié à une proposition » n'est jamais supprimé, quelle que soit la durée de l'attente (H-01). Sa durée de conservation ne commence à courir que lorsqu'il devient non pertinent.
- **COL-39** [Lot 2] — La suppression est faite par la tâche de purge (document 14) ; chaque passage est consigné dans le journal avec le nombre d'articles supprimés.

### Surveillance des sources

- **COL-40** [Lot 2] — Une source a un état de santé : « jamais lue », « fonctionnelle », « en panne » ou « muette ». Il est distinct de son état d'activation (active, désactivée, retirée), qui dépend de l'utilisateur. Chaque changement d'état de santé est daté, et la source indique depuis quand elle est dans son état ; l'entrée et la sortie de l'état « en panne » ouvrent et closent l'incident correspondant (COL-41, COL-43).
- **COL-41** [Lot 2] — Une lecture échoue quand le flux est injoignable, répond par une erreur, ne fournit pas un contenu lisible ou n'est plus un flux d'actualités. Après un nombre paramétrable d'exécutions consécutives en échec (par défaut 2, H-COL-04), la source passe « en panne » et un incident « flux en panne » est ouvert (documents 11 et 14). Elle reste active et est retentée à chaque exécution.
- **COL-42** [Lot 2] — Une source dont les lectures réussissent sans apporter aucun article nouveau pendant un délai de silence paramétrable, propre à chaque source (par défaut 3 jours, H-COL-04), passe « muette » et un avertissement est ouvert ; il invite l'utilisateur à vérifier que l'adresse du flux est toujours la bonne.
- **COL-43** [Lot 2] — Dès qu'une lecture apporte de nouveau des articles, la source redevient « fonctionnelle », l'incident ou l'avertissement est clos et le journal consigne la durée de l'interruption.
- **COL-44** [Lot 2] — Si toutes les sources actives échouent au cours d'une même exécution, un seul incident « collecte impossible » est ouvert au lieu d'un incident par source, car la cause probable se trouve alors du côté de l'application ou de sa connexion.

### Rattrapage et trous de collecte

- **COL-45** [Lot 2] — Lorsque la dernière lecture réussie d'une source est plus ancienne que l'ancienneté maximale (exécutions manquées, panne de l'hébergement ou du flux), l'ancienneté admise pour cette source est allongée de la durée écoulée depuis cette lecture ; tous les éléments que le flux propose encore pour cette période sont recueillis.
- **COL-46** [Lot 2] — À chaque lecture, si l'élément le plus ancien proposé par le flux a été publié après la dernière lecture réussie, la période qui les sépare est enregistrée comme **trou de collecte possible**, avec la source et les deux instants. Les trous de collecte restent consultables sans limite de durée, car ils disent où des événements ont pu être manqués (H-01). Un trou constaté alors qu'aucune exécution n'a été manquée signale un flux qui ne garde pas assez d'éléments pour l'intervalle entre deux collectes : un avertissement suggère d'ajouter une heure de collecte (COL-12).
- **COL-47** [Lot 2] — Les articles recueillis par rattrapage sont traités comme les autres ; leur ordre de passage au modèle relève du document 04. Aucune recherche dans des archives n'est faite pour combler un trou de collecte (Q-COL-01).

### Journal de collecte

- **COL-48** [Lot 2] — Chaque exécution produit une entrée de journal : instants de début et de fin, origine (planifiée, à la demande, avec rattrapage) et, pour chaque source, le résultat (réussite, ou échec avec sa raison en langage courant), le nombre d'éléments lus, d'articles nouveaux, de doublons, d'éléments trop anciens, incomplets ou en langue non traitée, et d'anomalies de date. L'entrée récapitule les totaux, les trous de collecte constatés et les incidents ouverts ou clos.
- **COL-49** [Lot 2] — Le journal de collecte est consultable par l'utilisateur, filtrable par source et par période, et rédigé pour un non-spécialiste (document 14). Depuis une entrée, l'utilisateur peut ouvrir la liste des articles enregistrés lors de cette exécution, tant qu'ils sont conservés.
- **COL-50** [Lot 2] — Le journal de collecte suit la durée de conservation des journaux fixée par le document 14, à l'exception des trous de collecte (COL-46).

## Données manipulées

- **Source** : nom du média ; adresse du flux ; langue (anglais ou français) ; fuseau horaire du média, facultatif ; délai de silence propre, facultatif ; attestation « presse sportive publique » et sa date ; état d'activation (active, désactivée, retirée) ; état de santé (jamais lue, fonctionnelle, en panne, muette) et instant depuis lequel la source s'y trouve ; instant de la dernière lecture réussie ; périodes de désactivation ; indicateurs de la règle COL-11.
- **Article** : titre ; nom du média ; lien ; instant de publication retenu et sa précision (exacte, approximative, absente) ; instant de première collecte ; langue ; sources où il a été vu ; court extrait, effacé au terme de la durée de la règle COL-36 ; état de traitement (COL-35) et, s'il est non pertinent, le motif fourni par la détection et la date de suppression prévue.
- **Trace de dédoublonnage** : lien et instant de première collecte d'un article supprimé, avec la date de fin de conservation de la trace.
- **Trou de collecte** : source, début et fin de la période possiblement manquée, instant du constat.
- **Entrée du journal de collecte** : contenu décrit à la règle COL-48.
- **Paramètres** : heure ou heures de collecte, nombre de tentatives, ancienneté maximale, fenêtre de dédoublonnage par titre, longueur de l'extrait, durée de conservation des articles non pertinents, durée de conservation des traces, nombre d'exécutions en échec avant panne, délai de silence, période des indicateurs. Ils figurent dans les réglages centralisés (document 14).

## Cas limites et erreurs

- **Titre récurrent.** Un média publie chaque jour un article intitulé « Les résultats de la nuit ». Les instants étant distants d'environ 24 heures, au-delà de la fenêtre de 6 heures, ce sont des articles distincts.
- **Lien changeant.** Un même article apparaît avec des liens qui ne diffèrent que par des éléments de suivi : le nettoyage du lien (COL-28) les identifie ; à défaut, la règle du média, du titre et de l'instant (COL-30) s'applique.
- **Date dans le futur.** Un flux annonce une publication postérieure à sa lecture : la règle COL-22 s'applique.
- **Flux qui change d'adresse.** Si le flux signale lui-même une nouvelle adresse, l'application la suit pour l'exécution en cours, le consigne dans le journal et propose à l'utilisateur de mettre la source à jour ; sans confirmation, l'adresse enregistrée est conservée.
- **Flux vide.** Un flux lisible qui ne contient aucun élément compte comme une lecture réussie sans article nouveau ; il peut rendre la source muette.
- **Source hors sujet.** Une source généraliste fournit surtout des articles sans rapport avec la NBA : ils sont collectés, puis non retenus par le préfiltrage, sans appel au modèle. La faible part d'articles retenus, visible dans les indicateurs (COL-11), invite l'utilisateur à revoir son choix.
- **Article publié pendant un match.** Il est daté à son instant retenu ; le document 08 décide à quel match l'événement se rattache.
- **Changement d'heure.** Les instants étant absolus, une exécution le jour d'un changement d'heure en France ou aux États-Unis n'introduit aucun décalage (document 14).
- **Longue interruption.** Après dix jours sans collecte, le rattrapage recueille ce que les flux proposent encore ; les trous de collecte possibles sont consignés, et les événements correspondants pourront être détectés après le coup d'envoi de leur match (document 04).
- **Article retiré par le média.** Le lien d'un article déjà collecté ne fonctionne plus : l'application ne vérifie pas ses liens et n'en est pas informée ; l'article reste cité tel qu'il a été collecté.
- **Retrait d'un événement récent.** Faute de trace de dédoublonnage (COL-37), un article encore proposé par un flux dans la limite de l'ancienneté maximale peut être collecté de nouveau et faire renaître l'événement ; l'utilisateur doit alors le retirer de nouveau (document 13, Q-DSN-01).

## Critères d'acceptation

- **CA-COL-01** (COL-02) — Étant donné un flux qui exige une identification, quand l'utilisateur tente de l'ajouter, alors l'ajout est refusé et le message indique que seules les sources publiques lisibles sans identification sont admises.
- **CA-COL-02** (COL-04) — Étant donné un flux dont aucun élément ne porte de date, quand l'utilisateur tente de l'ajouter, alors l'ajout est refusé.
- **CA-COL-03** (COL-04, COL-20) — Étant donné un flux dont les éléments ne portent qu'une date sans heure, quand l'utilisateur l'ajoute, alors un avertissement s'affiche avant la confirmation, et les articles collectés ensuite ont la précision « approximative ».
- **CA-COL-04** (COL-07) — Étant donné une source déjà inscrite, quand l'utilisateur saisit la même adresse, alors l'ajout est refusé et la source existante est indiquée.
- **CA-COL-05** (COL-12, COL-16, COL-48) — Étant donné deux sources actives et la collecte réglée à 22 h, heure de Paris, quand 22 h arrive, alors chaque source est lue une fois, les nouveaux articles sont enregistrés à l'état « à analyser » et transmis à la détection, et une entrée de journal récapitule l'exécution.
- **CA-COL-06** (COL-19, COL-20) — Étant donné un élément publié le mardi 10 novembre 2026 à 23 h 10, heure de New York, quand il est collecté, alors son instant retenu s'affiche « mercredi 11 novembre 2026 à 5 h 10, heure de Paris », avec la précision « exacte ».
- **CA-COL-07** (COL-21, COL-22) — Étant donné un élément daté du seul jour J, sans heure, provenant d'une source dont le fuseau du média n'est pas connu, et un match du joueur A le jour J à 19 h 30, heure de New York, quand l'élément est collecté pour la première fois le lendemain, alors son instant retenu est postérieur au coup d'envoi de ce match.
- **CA-COL-08** (COL-22) — Étant donné un élément qui annonce une publication postérieure à l'instant où il est lu, quand il est collecté, alors son instant retenu est l'instant de première collecte, sa précision est « approximative » et le journal compte une anomalie de date.
- **CA-COL-09** (COL-30, COL-33) — Étant donné un article collecté la veille et toujours présent dans le flux, quand la collecte suivante s'exécute, alors il n'est ni enregistré une seconde fois ni transmis de nouveau à la détection, et il est compté comme doublon.
- **CA-COL-10** (COL-31) — Étant donné un même article d'un média national présent dans le flux de ce média et dans un agrégateur, quand les deux sources sont lues, alors un seul article est enregistré et les deux sources y figurent.
- **CA-COL-11** (COL-32) — Étant donné une même dépêche reprise par deux médias, quand les deux flux sont lus, alors deux articles distincts sont enregistrés.
- **CA-COL-12** (COL-17) — Étant donné un élément rédigé dans une autre langue que l'anglais ou le français, quand il est lu, alors il n'est pas enregistré et le journal le compte.
- **CA-COL-13** (COL-24) — Étant donné une nouvelle source dont le flux contient des éléments publiés il y a un mois, quand elle est lue pour la première fois, alors seuls les éléments publiés depuis moins de 3 jours sont enregistrés.
- **CA-COL-14** (COL-25, COL-26, COL-27) — Étant donné un élément dont l'extrait compte 2 000 caractères et qui indique un auteur et une image, quand il est collecté, alors seuls les 500 premiers caractères de l'extrait sont conservés, sans mise en forme, ni l'auteur ni l'image ne sont conservés, et aucune donnée n'est récupérée depuis la page de l'article.
- **CA-COL-15** (COL-34, COL-36, COL-39) — Étant donné un article non pertinent collecté il y a 30 jours, quand la purge passe, alors il est supprimé, sa trace de dédoublonnage est conservée et le journal compte la suppression ; s'il est encore proposé par le flux le lendemain, il n'est pas enregistré de nouveau.
- **CA-COL-16** (COL-37, COL-38) — Étant donné un article rattaché à un événement et un article en attente de classification, tous deux collectés il y a 40 jours, quand la purge passe, alors aucun des deux n'est supprimé, et seul l'extrait de l'article rattaché est effacé.
- **CA-COL-17** (COL-40, COL-41, COL-43) — Étant donné une source injoignable lors de deux exécutions consécutives, quand la seconde se termine, alors la source est « en panne » et un incident est ouvert ; quand une lecture ultérieure réussit et apporte des articles, alors la source redevient « fonctionnelle », l'incident est clos et la durée de la panne est consignée.
- **CA-COL-18** (COL-42) — Étant donné une source lisible qui n'a apporté aucun article nouveau depuis 3 jours, quand l'exécution se termine, alors la source est « muette » et un avertissement est ouvert.
- **CA-COL-19** (COL-44) — Étant donné cinq sources actives qui échouent toutes au cours d'une même exécution, quand l'exécution se termine, alors un seul incident « collecte impossible » est ouvert.
- **CA-COL-20** (COL-45, COL-46) — Étant donné une collecte interrompue pendant six jours et un flux qui ne propose plus que les articles des quatre derniers jours, quand la collecte reprend, alors tous les articles de ces quatre jours sont recueillis malgré l'ancienneté maximale de 3 jours, et un trou de collecte possible d'environ deux jours est enregistré pour cette source.
- **CA-COL-21** (COL-46) — Étant donné un flux qui ne garde que ses vingt derniers éléments et en publie cinquante par jour, quand la collecte quotidienne s'exécute sans exécution manquée, alors un trou de collecte possible est enregistré et un avertissement suggère d'ajouter une heure de collecte.
- **CA-COL-22** (COL-09) — Étant donné une source désactivée pendant une semaine, quand l'utilisateur la réactive, alors l'exécution suivante applique l'ancienneté maximale ordinaire et le journal mentionne une période non collectée pour cause de désactivation.
- **CA-COL-23** (COL-10) — Étant donné une source retirée dont un article est rattaché à un événement, quand l'utilisateur consulte cet événement, alors l'article reste affiché avec le nom de son média et son lien.
- **CA-COL-24** (COL-14, COL-15) — Étant donné une collecte en cours, quand l'utilisateur lance une collecte à la demande, alors celle-ci est différée jusqu'à la fin de la première, et l'enchaînement des deux ne crée aucun doublon.
- **CA-COL-25** (COL-48, COL-49) — Étant donné une exécution au cours de laquelle une source a échoué, quand l'utilisateur filtre le journal de collecte sur cette source, alors il voit l'entrée de l'exécution avec la raison de l'échec en langage courant, et il peut ouvrir la liste des articles enregistrés lors de cette exécution.
- **CA-COL-26** (COL-28, COL-30) — Étant donné deux éléments d'un même flux dont les liens ne diffèrent que par des éléments de suivi publicitaire, quand ils sont lus, alors un seul article est enregistré, avec le lien nettoyé.
- **CA-COL-27** (COL-37) — Étant donné un événement retiré dont un article n'est rattaché qu'à lui et un autre article rattaché aussi à un second événement, quand le retrait est confirmé, alors le premier article est effacé sans trace de dédoublonnage, et le second reste rattaché au second événement.
- **CA-COL-28** (COL-40) — Étant donné une source passée « en panne » lors de l'exécution du lundi, quand l'utilisateur consulte la liste des sources le mercredi, alors il lit que la source est en panne depuis lundi.

## Dépendances

- [00 — Vue d'ensemble](00-vue-d-ensemble.md) : glossaire (article, événement) et place de la collecte dans le parcours de bout en bout.
- [04 — Détection des événements](04-detection-des-evenements.md) : reçoit les articles à analyser, fait évoluer leur état de traitement, fournit le motif de non-pertinence, permet le repêchage et calcule la date de référence d'un événement à partir des instants retenus.
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : exploite, à travers la date de référence des événements, l'instant retenu et sa précision pour rattacher un événement à son match mesuré.
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : Q-SUI-02, sur l'heure de la collecte et la part des cas suivis enregistrés à temps.
- [11 — Notifications Telegram](11-notifications-telegram.md) : messages d'incident « flux en panne » et « collecte impossible » ; l'avertissement « source muette » est notifié comme un incident (TEL-15, H-TEL-07).
- [12 — Interface et accès](12-interface-et-acces.md) : écrans de la liste des sources, de l'essai d'une source, du journal de collecte et de la collecte à la demande (IHM-36, IHM-71) ; réglage du fuseau de l'utilisateur (IHM-14), dans lequel s'exprime l'heure de collecte.
- [13 — Données sensibles](13-donnees-sensibles.md) : règles de stockage minimal et d'effacement, qui priment sur la conservation décrite ici ; flux publics sans contournement d'accès (DSN-02) ; références conservées après la purge (DSN-09) ; retrait d'un événement et effacement de ses articles (DSN-27, DSN-34) et Q-DSN-01.
- [14 — Exigences transverses](14-exigences-transverses.md) : calendrier d'ensemble des tâches (TRV-25), purge, journalisation, incidents, réglages centralisés, instants absolus.

## Hypothèses et questions ouvertes

Renvois au journal : Q-02 (aucun service de flux n'est choisi ; les critères figurent dans le document 14), H-01 (exhaustivité, d'où la visibilité des trous de collecte), H-11 (langues), H-12 (lot 2).

Renvois à d'autres documents : Q-SUI-02 du document 10, sur la meilleure heure de collecte et de détection (voir H-COL-01) ; Q-DSN-01 du document 13, sur l'empreinte d'un événement retiré (voir COL-37).

Hypothèses locales, toutes à confirmer :

- **H-COL-01 — Heure de la collecte.** Une exécution par jour à 22 h, heure de Paris. La plupart des matchs NBA commencent entre 1 h et 4 h 30, heure de Paris : une collecte à 22 h capte l'essentiel des nouvelles de la journée américaine avant ces matchs. Les matchs d'après-midi (week-ends, jours fériés américains) commencent plus tôt et peuvent précéder la collecte ; l'utilisateur peut ajouter d'autres heures. Cette heure fixe la part des cas suivis enregistrés avant le coup d'envoi ; la meilleure heure reste une question ouverte (Q-SUI-02 du document 10), et le calendrier d'ensemble du document 14 la reprend.
- **H-COL-02 — Fenêtres de temps.** Ancienneté maximale d'un article à la collecte : 3 jours. Fenêtre de dédoublonnage par média et titre : 6 heures.
- **H-COL-03 — Contenu limité au flux.** L'application ne consulte jamais la page de l'article et limite l'extrait conservé à 500 caractères ; l'extrait d'un article rattaché à un événement est effacé au même terme que les articles non pertinents. La classification ne dispose donc que du titre et de l'extrait, ce qui peut réduire sa justesse.
- **H-COL-04 — Durées et seuils.** Conservation des articles non pertinents : 30 jours. Conservation des traces de dédoublonnage : 180 jours. Tentatives de lecture par exécution : 3. Exécutions consécutives en échec avant l'état « en panne » : 2. Délai de silence : 3 jours. Période des indicateurs de source : 30 jours.
- **H-COL-05 — Datation prudente.** La traduction concrète du principe de prudence (fin de journée ou heure prise dans le fuseau le plus tardif possible, borne de la première collecte) et l'acceptation, avec avertissement, des sources datées sans heure.
- **H-COL-06 — Agrégateurs.** Les flux qui regroupent plusieurs médias sont admis, avec le média d'origine quand le flux l'indique. Un agrégateur peut proposer des médias non sportifs : l'attestation de l'utilisateur (COL-03) vaut pour toute la source.

Questions ouvertes locales :

- **Q-COL-01 — Combler un trou de collecte.** Après une interruption plus longue que ce que conservent les flux, faut-il un moyen de rechercher les articles manqués dans des archives d'actualités (D-10) ? Par défaut, rien n'est fait au-delà du rattrapage et le trou reste signalé.
- **Q-COL-02 — Sources initiales.** Aucune source n'est désignée. Faut-il que l'agent de développement propose une liste de départ répondant aux critères (presse sportive publique, datée, en anglais ou en français), à faire valider par l'utilisateur ?
