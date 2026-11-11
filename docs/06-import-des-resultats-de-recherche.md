# 06 — Import des résultats de recherche

## Objet

L'import fait entrer dans l'application le résultat de recherche que l'utilisateur rapporte de son IA de recherche approfondie. Il isole le JSON du texte collé, le contrôle, montre avant tout enregistrement ce qui sera ajouté, ignoré, refusé ou fusionné, puis enregistre les événements historiques avec leur trace et lance la suite du traitement. Il couvre aussi les imports ultérieurs pour un joueur déjà traité et la correction ou la suppression manuelle d'un événement importé.

## Décisions d'origine

- **D-07 bis** — Gratuité : les traitements lancés après l'import composent avec les quotas des services gratuits.
- **D-09** — L'utilisateur rapporte lui-même le résultat de la recherche approfondie à l'application.
- **D-10** — Les sources doivent être datées et vérifiables, et garantir que l'événement était connu avant le match.
- **D-12** — Seuls les types validés par l'utilisateur comptent.
- **D-14** — Le résultat revient en JSON strict.
- **D-17** — Les joueurs suivis sont très médiatisés : un historique vide est inhabituel.
- **D-18** — Les données vivent dans une base de données.
- **D-19** — Les champs de contexte servent à exclure les cas douteux.
- **D-20** — Presse publique, stockage minimal, aucun détail intime.
- **D-22** — L'import du JSON fait partie de l'application minimale.
- **D-24** — L'utilisateur colle le résultat ; l'application le stocke.
- **D-25** — Application installable, utilisée sur téléphone.
- **D-27** — La recherche ne fournit aucune statistique ; l'application les récupère elle-même.
- **D-32** — Les convictions de l'utilisateur reposent sur des exemples marquants : l'historique ne doit pas se réduire à eux.
- **H-01** — Comptage exhaustif, y compris les événements suivis d'une contre-performance.
- **H-02** — Le match mesuré est le premier match joué après que l'événement est devenu public ; un événement publié après le coup d'envoi ne compte pas pour ce match.
- **H-05** — Un backtest couvre les types validés à la date de la demande ; des compléments sont possibles.
- **H-07** — Les événements détectés sont enregistrés et suivis même sans backtest : ils peuvent recouper un backtest.
- **H-08** — L'utilisateur peut écarter un événement détecté à tort.
- **H-09** — Le retour de blessure et l'enjeu du match, signalés par la recherche, sont corrigeables par l'utilisateur.
- **H-12** — Lot 1 : import du JSON ; lot 2 : détection quotidienne.

## Périmètre

Ce document couvre :

- le collage du texte, sur téléphone en particulier, et l'isolement du JSON ;
- les contrôles de validité et les messages qui disent quoi corriger ;
- l'aperçu avant enregistrement et l'import partiel ;
- les doublons avec les événements déjà connus, historiques ou détectés ;
- les nouveaux imports pour un joueur déjà traité, en complément ou en remplacement ;
- l'enregistrement, la traçabilité et le passage de la demande à « importée » ;
- la correction et la suppression manuelles d'un événement importé ;
- le déclenchement des traitements suivants.

Il ne couvre pas :

- la définition du format, le prompt, le cycle de vie des demandes et la couverture : [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) ;
- la récupération du calendrier et des statistiques : [07 — Statistiques de match](07-statistiques-de-match.md) ;
- le rattachement au match mesuré, les cas, les exclusions et le calcul : [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) ;
- les événements détectés : [04 — Détection des événements](04-detection-des-evenements.md), et leur suivi : [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) ;
- la disposition des écrans : [12 — Interface et accès](12-interface-et-acces.md) ;
- les règles générales de conservation et de retrait des données sensibles : [13 — Données sensibles](13-donnees-sensibles.md) ;
- la gestion des paramètres et du journal de l'application : [14 — Exigences transverses](14-exigences-transverses.md) ;
- l'ajout à la main d'un événement historique sans passer par un import, que ce document ne prévoit pas (Q-IMP-02).

## Acteurs et déclencheurs

- **L'utilisateur** : colle le résultat, lit l'aperçu, choisit le mode d'import et le sort des doublons, confirme ou abandonne, corrige ou supprime des événements.
- **L'application** : isole le JSON, le contrôle, présente l'aperçu, enregistre, trace et lance les traitements suivants.
- **L'IA de recherche approfondie**, indirectement : elle a produit le texte collé, qui est traité comme une donnée non sûre.
- **Déclencheurs** : l'action « Coller le résultat » d'une demande ou du bandeau « Backtest en cours » de l'accueil (document 12) ; la fiche d'un événement historique, pour une correction ou une suppression.

## Parcours

### Scénario nominal

1. L'IA a répondu ; sur son téléphone, l'utilisateur copie la réponse entière.
2. Dans l'application, il ouvre la demande à faire du joueur A et touche « Coller le résultat ».
3. Il colle le texte et touche « Vérifier ».
4. L'application isole le JSON, lit sa version, et rattache le résultat à la demande et au joueur.
5. Elle contrôle l'ensemble du résultat, puis chaque événement, et cherche les doublons.
6. Elle affiche l'aperçu : décompte, couverture, répartition par saison, refus, avertissements, doublons, pistes et limites, sondage proposé.
7. L'utilisateur relit, ouvre au besoin quelques sources, puis touche « Enregistrer ».
8. L'application enregistre les événements historiques, la couverture et la trace ; la demande passe à « importée ».
9. Elle demande les statistiques nécessaires (document 07), puis le calcul du profil (document 08).
10. Elle affiche le bilan et, s'il y a lieu, propose un complément ou le message de correction.

### Variantes

- **Erreur bloquante** (format inconnu, joueur différent, champ d'ensemble manquant, syntaxe) : rien n'est enregistré ; l'application explique quoi corriger et propose le message de correction.
- **Résultat coupé** : la partie complète est récupérée quand c'est possible ; sinon le message de correction demande une réponse plus courte.
- **Événements refusés** : correction d'abord, ou enregistrement partiel après avertissement.
- **Nouvel import pour un joueur déjà traité** : choix entre complément, par défaut, et remplacement.
- **Demande annulée** : confirmation, puis passage à « importée ».
- **Résultat collé dans la mauvaise demande** : l'application propose d'ouvrir la bonne.
- **Résultat vide** : aperçu à zéro événement, puis enregistrement de la couverture.
- **Fichier texte** choisi au lieu d'un collage.
- **Calendrier indisponible** : l'antériorité des sources est établie plus tard.

## Règles de gestion

### Collage et lecture du texte

- **IMP-01 [Lot 1] — Points d'entrée.** L'import s'ouvre depuis une demande, quel que soit son état (IMP-08), par l'action « Coller le résultat » de l'écran de la demande, ou par le même bouton du bandeau « Backtest en cours » de l'accueil (document 12, IHM-27, IHM-40). L'écran d'import est toujours rattaché à une demande (IHM-28) ; la référence contenue dans le résultat permet de vérifier que c'est la bonne (IMP-07).
- **IMP-02 [Lot 1] — Collage sur téléphone.** L'écran d'import offre un grand champ de saisie où la correction automatique, la ponctuation intelligente (qui changerait les guillemets droits en guillemets typographiques) et la majuscule automatique sont désactivées ; un bouton « Coller » qui lit le presse-papiers quand le téléphone l'autorise, l'appui long restant possible ; le choix d'un fichier texte, à défaut de collage (D-25). Il affiche le nombre de caractères reçus et la fin du texte, pour que l'utilisateur voie s'il a tout copié. Au-delà de 2 Mo (paramétrable, H-IMP-02), le texte est refusé avec cette explication.
- **IMP-03 [Lot 1] — Rien avant la confirmation.** Aucune donnée n'est enregistrée avant que l'utilisateur confirme l'aperçu ; il peut abandonner à tout moment, et la fermeture de l'application pendant l'aperçu n'enregistre rien. Le texte collé n'est gardé que comme brouillon d'import, dans les limites que fixe le document 13 (DSN-32) et selon le document 12 (IHM-42) ; il n'est jamais conservé avec les données enregistrées, ni dans la trace de l'import, ni dans le journal, ni dans les sauvegardes (D-20, H-IMP-10).
- **IMP-04 [Lot 1] — Texte autour du JSON.** L'import isole l'objet JSON du résultat : il ignore ce qui le précède et le suit (introduction, rapport, conclusion), les balises de bloc de code et les caractères invisibles. Si plusieurs objets sont présents, il retient celui dont le champ `format` vaut « egoscope-backtest » ; s'il en reste plusieurs, il demande de n'en coller qu'un. Il ne corrige aucune autre faute : une erreur de syntaxe à l'intérieur de l'objet est signalée avec son endroit approximatif, par exemple « vers le 12e événement ».
- **IMP-05 [Lot 1] — Résultat coupé.** Un texte qui s'arrête avant la fin de l'objet est signalé comme coupé. Si les champs placés avant la liste des événements sont complets et que les événements complets sont triés par date publique, l'import propose de récupérer ces événements : la période couverte est alors ramenée à la veille de la date publique du dernier événement récupéré, ce qui fait apparaître la suite comme un manque à compléter (document 05, BKT-06), et les pistes et limites, placées après, sont perdues. Sinon, rien n'est récupéré (H-IMP-04).

### Rattachement

- **IMP-06 [Lot 1] — Format et version.** L'import lit le format défini par le document 05 dans toutes les versions qu'il connaît, soit au lot 1 la seule version 1.0. Un résultat d'une version inconnue est refusé, avec l'invitation à régénérer le prompt. Un JSON d'un autre format, par exemple le résultat du prompt d'exploration de types (document 02), est refusé avec le message « ce texte n'est pas un résultat de backtest ». Si le champ `format` ou le champ `version_format` manque mais que la structure est reconnue, l'import continue avec un avertissement, en supposant la version la plus récente qu'il connaît.
- **IMP-07 [Lot 1] — Demande et joueur.** La référence désigne la demande ; l'identifiant du joueur doit être celui de la demande, un nom différent ne donnant qu'un avertissement. Si le résultat désigne une autre demande que celle depuis laquelle il est collé, l'import le dit et propose d'ouvrir la bonne. Si la référence manque ou est inconnue, l'import cherche le joueur par son identifiant, puis par son nom, et propose de rattacher le résultat à l'une de ses demandes ; s'il ne trouve pas le joueur, le résultat est refusé.
- **IMP-08 [Lot 1] — État de la demande.** Une demande à faire s'importe normalement. Une demande déjà importée peut recevoir un nouvel import (IMP-28, IMP-29). Une demande annulée exige une confirmation explicite, « cette demande a été annulée le … : importer quand même ? » ; si l'import est confirmé, elle passe à « importée » (document 05, BKT-13, H-IMP-05).

### Contrôles

- **IMP-09 [Lot 1] — Contrôles d'ensemble.** Le résultat entier est refusé, sans rien enregistrer, si le rattachement échoue (IMP-07) ; si `types_couverts` manque, est vide ou ne contient aucun type de la demande ; si `periode_couverte` manque, porte une date invalide ou un début postérieur à sa fin ; si `evenements` manque ou n'est pas une liste. Les listes `pistes_non_verifiees` et `limites` absentes sont tenues pour vides, avec un avertissement.
- **IMP-10 [Lot 1] — Couverture déclarée.** Les types déclarés couverts qui ne figurent pas dans la demande sont ignorés ; une période couverte qui déborde la période demandée y est ramenée ; chacun de ces cas donne un avertissement. La couverture retenue est, pour chaque type déclaré et demandé, la partie commune de sa période demandée et de la période déclarée ; elle est enregistrée à la confirmation (document 05, BKT-10). Les types demandés non déclarés et les périodes manquantes sont présentés comme des manques.
- **IMP-11 [Lot 1] — Type.** Un événement est refusé si son type manque ou ne correspond à aucun type de la taxonomie. Un événement qui porte l'identifiant d'un type absorbé par une fusion est rattaché au type subsistant, comme l'ont été les événements de ce type lors de la fusion, avec un avertissement (document 02, TAX-27, TAX-28) ; celui d'un type scindé n'est pas rattaché d'office : l'aperçu demande à l'utilisateur de choisir l'un des types issus de la scission, ou de l'ignorer (TAX-30). Dans ces deux cas, le type subsistant ou choisi n'est tenu pour couvert que s'il figurait dans la demande. Hors fusion et scission, un événement est ignoré, avec son motif, si son type existe mais n'est pas à l'état « validé » au moment de l'import (proposé, rejeté ou retiré, document 02), ou s'il ne fait pas partie de la demande : un événement d'un type retiré n'est donc jamais enregistré, même pour une demande antérieure au retrait (TAX-31), mais il ne compte pas parmi les refus, que l'IA pourrait corriger. La comparaison ne tient compte ni des majuscules ni des espaces superflus. Un événement d'un type demandé mais absent de `types_couverts` est accepté avec un avertissement, sans que ce type soit tenu pour couvert.
- **IMP-12 [Lot 1] — Date publique.** Un événement est refusé si sa date publique manque, n'est pas dans l'un des deux formats admis (document 05) ou n'existe pas au calendrier. Il est ignoré si elle tombe hors de la période demandée, ou avant le premier match NBA du joueur ; quand la date de ce premier match est inconnue, la borne basse est le début de la période déclarée. Une date publique comprise dans la période demandée mais hors de la période déclarée donne un avertissement.
- **IMP-13 [Lot 1] — Description.** Un événement est refusé si sa description manque, est vide, dépasse la longueur maximale d'une description (document 13, DSN-20) ou contient des guillemets, droits ou typographiques, signe d'une citation que le document 13 interdit (DSN-21, DSN-24). Une description qui semble contenir des statistiques ou des scores, par exemple des nombres suivis de « points », « rebonds » ou « passes », donne un avertissement. L'aperçu affiche chaque description et rappelle les autres règles du document 13 (DSN-12 à DSN-23), qui ne se vérifient qu'à la lecture.
- **IMP-14 [Lot 1] — Sources.** Une source n'est pas retenue, avec un avertissement, si son lien n'est pas une adresse complète (commençant par « https:// » ou « http:// », avec un nom de domaine, sans espace, et désignant autre chose qu'une page d'accueil), si ce lien relève de la liste des domaines non admis, qui réunit réseaux sociaux, forums, encyclopédies collaboratives et plateformes de vidéo, sources que le document 13 n'admet pas (DSN-01, DSN-03 ; liste paramétrable, H-IMP-13), ou si sa date de publication manque, est mal formée ou postérieure au jour de l'import ; un média ou un titre manquant ne donne qu'un avertissement. L'événement est refusé si aucune source exploitable ne reste. Au-delà du nombre maximal de sources (document 05), seules les plus anciennes sont gardées. L'événement est aussi refusé si une source est publiée plus d'un jour (paramétrable, H-IMP-02) avant sa date publique : l'une des deux dates est fausse. L'aperçu rappelle que seuls des articles de presse publiés sont admis, ce que l'application ne peut pas toujours vérifier seule.
- **IMP-15 [Lot 1] — Confiance de la recherche, contexte et textes secondaires.** Une confiance de la recherche absente ou hors des valeurs permises devient « faible » ; un contexte absent, ou une valeur de contexte hors liste, devient « inconnu » ; une précision, une réserve ou une limite trop longue est ignorée, de même qu'une piste incomplète ou trop longue. Chacun de ces cas donne un avertissement. Les valeurs sont comparées sans tenir compte des majuscules ni des accents.
- **IMP-16 [Lot 1] — Champs inconnus et texte non sûr.** Tout champ que le format ne définit pas est ignoré et n'est jamais enregistré, en particulier toute statistique de match (D-27) ; l'aperçu le signale une fois. Les textes du résultat sont affichés comme du texte simple, et un lien ne s'ouvre que sur action de l'utilisateur.
- **IMP-17 [Lot 1] — Signaux contre les sources inventées.** En plus des contrôles d'IMP-14, l'import signale par un avertissement un même lien cité pour plusieurs événements différents. Après l'enregistrement, l'application tente d'ouvrir chaque lien et marque « introuvable » celui qui mène à une page inexistante, sans rien supprimer ; cette vérification se désactive par paramètre (H-IMP-08). Ces signaux repèrent des incohérences ; ils ne prouvent ni qu'un article existe, ni qu'il dit ce que le résultat lui prête, et l'aperçu le rappelle.
- **IMP-18 [Lot 1] — Antériorité au match.** Pour chaque événement, l'application compare la plus ancienne source au match mesuré, tel que le document 08 le détermine à partir des dates de matchs du document 07 (D-10, H-02). L'antériorité est « établie » si une source est publiée avant le jour du match, ou ce jour-là avec une heure antérieure au coup d'envoi ; « incertaine » si la plus ancienne source date du jour du match, sans heure ; « non établie » si toutes les sources sont publiées après le coup d'envoi. Si les dates de matchs sont déjà connues, l'aperçu donne le résultat ; sinon l'événement est marqué « antériorité à vérifier » et classé dès qu'elles le sont, avant tout calcul ; tant qu'il est à vérifier, il ne produit aucun cas compté (document 08, SEN-44). Un événement à l'antériorité non établie est enregistré et signalé, mais ne produit aucun cas compté (document 08, SEN-44 ; H-IMP-07) ; l'utilisateur peut lui ajouter une source plus ancienne (IMP-32). Le sort d'un événement à l'antériorité incertaine relève du document 08, qui le mesure par défaut sur le match suivant (SEN-44 ; Q-IMP-01).
- **IMP-19 [Lot 1] — Issue d'un événement.** Chaque événement du résultat aboutit à une seule issue : ajouté ; ajouté avec avertissement ; doublon, non ajouté (IMP-25 à IMP-27) ; ignoré, parce qu'il sort du champ de la demande ; refusé, parce qu'il présente un défaut que l'IA peut corriger ; non enregistré pour donnée sensible (IMP-37). Seuls les défauts qu'IMP-11 à IMP-14 désignent comme motifs de refus entraînent un refus (H-IMP-01). Les avertissements restent attachés à l'événement enregistré et visibles sur sa fiche.

### Messages

- **IMP-20 [Lot 1] — Messages d'erreur.** Chaque message dit, en français courant et sans jargon, où se trouve le problème (le résultat entier, ou l'événement désigné par son rang, son type et sa date), ce qui ne va pas, et comment le corriger. Exemples : « Le texte s'arrête avant la fin du résultat : il manque la fin du 38e événement. Recopiez toute la réponse, ou demandez à l'IA une réponse plus courte. » ; « 4e événement (humiliation-publique, 2021-02-30) : cette date n'existe pas. Indiquez la date publique au format AAAA-MM-JJ. » ; « 7e événement : "www.media-national.example" n'est pas l'adresse complète d'un article. Donnez l'adresse complète, qui commence par https://. » ; « 9e événement : la source est datée du 2020-03-02, avant la date publique du 2020-03-05. Corrigez la date publique ou retirez cette source. » ; « Ce résultat concerne le joueur B, alors que cette demande concerne le joueur A. »
- **IMP-21 [Lot 1] — Message de correction pour l'IA.** Quand le résultat est refusé, coupé, ou contient des événements refusés, l'application compose un message en français, prêt à copier, destiné à l'IA. Il rappelle la référence de la demande et la version du format ; il liste chaque problème (rang, type, date, champ, correction attendue) ; il demande de renvoyer le JSON complet corrigé, sans texte autour et sans rien inventer, en rangeant dans `pistes_non_verifiees` ce qui ne peut pas être étayé. Pour un résultat coupé, il demande de reprendre en s'arrêtant à la fin d'une saison complète et de déclarer la période couverte. L'utilisateur le colle dans la conversation où la recherche a été menée.

### Aperçu et import partiel

- **IMP-22 [Lot 1] — Aperçu avant enregistrement.** L'aperçu se lit sur téléphone : un résumé d'abord, puis le détail, replié. Il présente le joueur, la référence, le mode (premier import, complément ou remplacement) et la version du format ; le décompte de ce qui sera fait (événements ajoutés, dont avec avertissement ; doublons non ajoutés et sources rattachées à des événements existants ; événements ignorés ; événements refusés ; en remplacement, événements supprimés, dont ceux corrigés à la main) ; la couverture retenue et les manques ; la répartition des événements à ajouter par type et par saison (au sens du document 07), saisons sans événement comprises, pour juger de l'exhaustivité (H-01) ; l'antériorité quand elle est déjà calculable ; le détail des refus, des avertissements, des événements ignorés, des doublons et des doublons possibles ; les précisions de contexte, qui aident à vérifier les indications et ne sont pas conservées ; les pistes non vérifiées et les limites déclarées par l'IA, en lecture seule. Il propose « Enregistrer », « Copier le message de correction », qui copie le message d'IMP-21 (document 12, IHM-43), et « Abandonner ».
- **IMP-23 [Lot 1] — Sondage des sources.** L'aperçu propose d'ouvrir 3 sources (paramétrable, H-IMP-02) tirées au hasard parmi les événements à ajouter ; pour chacune, l'utilisateur peut indiquer « conforme », « non conforme » ou « inaccessible ». Le sondage est facultatif (H-IMP-09). Une source jugée non conforme est signalée sur son événement, et l'aperçu suggère de corriger le résultat avant de l'enregistrer. Le résultat du sondage figure dans la trace.
- **IMP-24 [Lot 1] — Import partiel.** Quand des événements sont refusés, l'aperçu recommande de corriger d'abord (IMP-21). L'utilisateur peut néanmoins enregistrer tout de suite les événements acceptés, après avoir confirmé l'avertissement « N événements refusés manqueront au backtest tant qu'ils n'auront pas été corrigés et réimportés ». La demande affiche alors ses refus restants, qui sont ceux de son dernier import (H-IMP-12), et la fiche du joueur les signale à côté de son profil (documents 08 et 12). Les événements corrigés se réimportent en complément (IMP-28).

### Doublons

- **IMP-25 [Lot 1] — Correspondance.** Deux événements du même joueur se correspondent s'ils ont le même type et des dates publiques distantes de 2 jours au plus (paramétrable, H-IMP-02), ou s'ils citent un même lien, les liens étant comparés après le nettoyage des éléments de suivi que décrit le document 03 (COL-28) (H-IMP-03). La date publique d'un événement détecté est sa date de référence (document 04) ; quand l'une des deux dates est sans heure, la distance retenue est la plus petite que permettent les fuseaux possibles, pour ne manquer aucun rapprochement (TRV-73). Un événement du résultat et un événement déjà enregistré, historique ou détecté, de types différents mais de dates publiques aussi proches forment un **doublon possible** : l'aperçu les présente côte à côte et l'utilisateur indique s'il s'agit du même fait, traité alors comme un doublon (IMP-26, IMP-27), ou de faits distincts ; l'enregistrement attend sa réponse. Les correspondances sont recherchées parmi les événements historiques déjà enregistrés, les autres événements du même résultat et, au lot 2, les événements détectés ; correspondances et doublons possibles sont recalculés au moment de l'enregistrement. La même règle sert à la détection pour reconnaître un fait déjà rapporté par un backtest (document 04, DET-58).
- **IMP-26 [Lot 1] — Doublon d'un événement historique.** Par défaut, un événement qui correspond à un événement historique enregistré n'est pas ajouté : ses sources nouvelles sont rattachées à l'événement existant, dans la limite du nombre maximal de sources, les plus anciennes étant gardées, et l'antériorité de cet événement est recalculée. L'aperçu montre les deux et permet de choisir « événements distincts » pour ajouter quand même le nouveau. Deux événements du même résultat qui se correspondent sont traités de même : le premier de la liste est gardé.
- **IMP-27 [Lot 2] — Doublon d'un événement détecté.** Un événement qui correspond à un événement détecté (document 04) n'est jamais ajouté en double. Si l'événement détecté est à l'état « détecté », il reste tel quel et demeure un cas suivi (document 10). S'il est « écarté » (H-08), l'événement du résultat n'est pas ajouté : pour rétablir ce fait, l'utilisateur réintègre l'événement détecté (document 04, DET-45), qui garde son origine « suivi ». L'import ne modifie jamais un événement détecté. À l'inverse, un fait déjà enregistré comme événement historique ne donne pas d'événement détecté (document 04, DET-58) : dans un sens comme dans l'autre, le premier enregistrement fixe l'origine du cas, et un même fait n'est jamais compté deux fois (document 10, SUI-07).

### Nouvel import pour un joueur déjà traité

- **IMP-28 [Lot 1] — Complément.** Quand le joueur a déjà des événements historiques dans les types et la période couverts par le résultat, l'aperçu propose deux modes, le complément étant le mode par défaut (H-IMP-06). En complément, seuls les événements sans correspondance sont ajoutés, et rien n'est supprimé : coller deux fois le même résultat n'ajoute donc rien.
- **IMP-29 [Lot 1] — Remplacement.** Choisi explicitement, le remplacement supprime les événements historiques du joueur issus d'imports antérieurs dont le type figure dans la couverture retenue du nouveau résultat et dont la date publique tombe dans sa période, puis ajoute les événements acceptés du nouveau résultat. Les événements détectés ne sont jamais touchés (H-IMP-06). L'aperçu annonce le nombre d'événements supprimés, en précisant combien avaient été corrigés à la main, corrections qui seront perdues, et demande une confirmation distincte. Les cas issus des événements supprimés disparaissent des calculs (document 08).

### Enregistrement et traçabilité

- **IMP-30 [Lot 1] — Enregistrement.** À la confirmation, en une seule opération qui réussit entièrement ou reste sans effet : les événements acceptés deviennent des événements historiques du joueur, chacun avec la version de fiche de son type que reprenait le prompt de la demande (document 02, TAX-23), sauf rattachement après une fusion ou une scission (IMP-11) ; les sources rattachées aux événements existants et les suppressions d'un remplacement sont appliquées ; la couverture retenue s'ajoute à celle du joueur (document 05, BKT-10) ; la trace de l'import est créée ; la demande passe à « importée » si elle ne l'était pas (document 05, BKT-13).
- **IMP-31 [Lot 1] — Trace.** Chaque import enregistré reçoit un numéro d'ordre et une trace (voir « Données manipulées ») qui dit quand il a eu lieu, pour quelle demande, et ce qu'il a ajouté, fusionné, ignoré, refusé ou supprimé. Chaque événement historique garde l'import qui l'a apporté, ceux qui lui ont ajouté des sources, et ses corrections. La fiche du joueur donne l'historique de ses imports (document 12). Un essai refusé en entier ne crée pas de trace d'import ; il est consigné dans le journal de l'application (document 14).

### Corrections et suppressions

- **IMP-32 [Lot 1] — Correction manuelle.** Sur la fiche d'un événement historique, l'utilisateur peut modifier le type (parmi les types validés), la date publique et son heure, la description, les sources (ajout, modification, retrait, une au moins devant rester), le contexte (H-09), la confiance de la recherche et la réserve. Les contrôles d'IMP-11 à IMP-14 s'appliquent à la modification : une modification qui ferait refuser ou ignorer l'événement est elle-même refusée, avec le même message. Pour une correction, la période de référence est la carrière NBA du joueur jusqu'au jour de la correction, et non la période de la demande. La correction est tracée (date et champs modifiés, sans l'ancienne valeur, D-20) ; l'antériorité est recalculée et le calcul relancé (document 08).
- **IMP-33 [Lot 1] — Suppression manuelle.** La suppression d'un événement historique exige un motif : fait inexact ou source fausse ; hors des critères du type ; doublon ; autre, avec une précision courte. Avant confirmation, l'application rappelle qu'un événement ne se supprime jamais à cause du match qui l'a suivi (H-01, D-32). La trace garde la date de suppression, le motif, le type et la date publique de l'événement. Un événement qu'il faut effacer pour une raison de sensibilité ne se supprime pas : il se retire selon le document 13 (DSN-26 à DSN-29), qui l'efface avec ses traces et le compte parmi les événements retirés (IMP-37, H-IMP-11). Le calcul est relancé (document 08).

### Suites de l'import

- **IMP-34 [Lot 1] — Statistiques et calcul.** Après l'enregistrement, l'application demande les statistiques nécessaires aux matchs mesurés des nouveaux événements et aux références de saison concernées (document 07), puis le calcul ou le recalcul du profil du joueur (document 08). L'import n'attend pas ces traitements : si la source de statistiques est indisponible ou si son quota est atteint, les événements restent enregistrés et leurs cas attendent (document 07). Les corrections, suppressions et remplacements déclenchent le même recalcul.
- **IMP-35 [Lot 1] — Bilan.** Le bilan affiché après l'enregistrement reprend le décompte, propose le complément qui couvrirait les manques (document 05, BKT-06) et, s'il reste des refus, le message de correction.
- **IMP-36 [Lot 2] — Fiche d'alerte après un import.** Si le joueur a un événement détecté dont le match mesuré n'a pas commencé, l'import déclenche la production de la fiche d'alerte de cet événement selon la règle du document 09 (ALE-05, H-ALE-03). Le pronostic de son cas suivi reste calculé sur les seuls cas historiques et figé au coup d'envoi (document 10, SUI-08, SUI-09).

### Retrait d'un événement

- **IMP-37 [Lot 1] — Retrait et import.** Le retrait d'un événement historique (document 13, DSN-26 à DSN-29) l'efface aussi des traces d'import : il disparaît de la trace de l'import qui l'a apporté, décomptes compris, avec ses sources, ses corrections et ses avertissements, de sorte qu'aucune trace d'import ne garde rien qui le désigne (DSN-27). Lors d'un import ultérieur, l'aperçu permet de ne pas enregistrer un événement accepté pour le seul motif « donnée sensible », par exemple un événement déjà retiré qu'un nouveau backtest rapporte de nouveau (DSN-28, Q-DSN-01) ; aucun autre motif ne le permet, pour que le tri ne dépende jamais du match qui a suivi (H-01), et chaque usage augmente le compteur des événements retirés (DSN-29).

## Données manipulées

Le sens de chaque champ du résultat est celui du format défini par le document 05 ; on décrit ici ce que l'import conserve.

### Import

- Numéro d'ordre, date et heure.
- Demande et joueur concernés, mode (premier import, complément, remplacement), version du format.
- Couverture retenue (types et périodes) et manques constatés.
- Décompte : événements ajoutés, dont avec avertissement ; doublons non ajoutés ; sources rattachées à des événements existants ; événements ignorés ; événements refusés ; événements supprimés par remplacement.
- Pour chaque refus et chaque événement ignoré : rang, type et date tels que lus, motif.
- Pour chaque doublon possible : l'événement existant concerné et la réponse de l'utilisateur.
- Avertissements portant sur le résultat entier : format absent, types ignorés, période ramenée, champs inconnus.
- Limites déclarées par l'IA, en texte, et nombre de pistes non vérifiées par type (H-IMP-10).
- Sondage : sources ouvertes et verdicts.
- Récupération d'un résultat coupé, le cas échéant.
- Événements apportés, et nombre d'événements supprimés.

### Événement historique

- Joueur, type et version de sa fiche (document 02, TAX-23), date publique (avec l'heure si elle est connue), description.
- Sources : lien, média, titre, date de publication ; pour chacune, l'import qui l'a apportée et, le cas échéant, la mention « introuvable » ou le verdict du sondage.
- Contexte : retour de blessure et enjeu du match, sous la forme fermée du document 05 ; la précision n'est pas conservée.
- Confiance de la recherche et réserve (champ `non_verifie`).
- Avertissements reçus ; antériorité : établie, incertaine, non établie ou à vérifier.
- Import d'origine ; corrections, avec leur date et les champs modifiés.

### Ce qui n'est pas conservé

- Le texte collé, au-delà du brouillon d'import (documents 12 et 13, IHM-42, DSN-32).
- Les champs inconnus, dont toute statistique.
- Le contenu des événements refusés ou ignorés, au-delà du rang, du type, de la date et du motif.
- Le texte des pistes non vérifiées.
- La précision du contexte, montrée seulement dans l'aperçu.
- L'ancienne valeur d'un champ corrigé.
- Le contenu d'un événement retiré (document 13), y compris dans les traces d'import (IMP-37), et celui d'un événement laissé de côté pour donnée sensible.
- L'aperçu et le message de correction, qui n'existent que le temps de l'import.

## Cas limites et erreurs

- **Texte vide ou sans objet JSON** : « Aucun résultat reconnaissable : vérifiez que vous avez copié toute la réponse de l'IA. »
- **Même résultat collé deux fois** : en complément, tout est doublon ; l'aperçu annonce « aucun événement nouveau ».
- **Deux imports simultanés**, par exemple dans deux onglets : les doublons sont recalculés à l'enregistrement ; si l'aperçu n'est plus à jour, il est réaffiché avant confirmation.
- **Type retiré entre la demande et l'import** : ses événements sont ignorés avec le motif « type non validé à ce jour », et il n'entre pas dans la couverture.
- **Type fusionné ou scindé entre la demande et l'import** : ses événements sont rattachés au type subsistant, ou répartis par l'utilisateur entre les types issus de la scission (IMP-11).
- **Même fait sous un autre type qu'un événement déjà enregistré** : doublon possible, soumis à l'utilisateur (IMP-25).
- **Événement retiré rapporté de nouveau** : l'aperçu permet de ne pas l'enregistrer pour donnée sensible (IMP-37) ; à défaut, il est enregistré comme les autres, et l'utilisateur peut le retirer de nouveau (document 13, Q-DSN-01).
- **Joueur retiré entre-temps** : sa demande a été annulée (document 05, BKT-14) ; IMP-08 s'applique.
- **Aucun événement acceptable** : l'enregistrement reste possible, avec l'avertissement d'IMP-24 ; la couverture est enregistrée et les refus restent affichés.
- **Résultat vide** : il est valide (document 05, BKT-23) ; l'aperçu annonce zéro événement, rappelle les limites déclarées, et souligne qu'un historique vide sur plusieurs saisons est inhabituel pour un joueur très médiatisé (D-17), sans le refuser.
- **Date du premier match NBA inconnue** : la borne basse est le début de la période déclarée (IMP-12).
- **Calendrier indisponible** : l'antériorité reste « à vérifier » jusqu'à ce qu'il le soit (IMP-18).
- **Source de statistiques indisponible ou quota atteint** : les événements sont enregistrés, leurs cas attendent (IMP-34).
- **Événement d'intersaison** : accepté ; son match mesuré, éventuellement lointain, relève du document 08.
- **Événements non triés** : acceptés, avec un avertissement ; l'ordre n'est indispensable que pour récupérer un résultat coupé (IMP-05).
- **Texte trop volumineux** : refusé avec son explication (IMP-02).

## Critères d'acceptation

1. **IMP-04** — **Étant donné** une réponse de l'IA faite d'une introduction, du JSON entre balises de code et d'une conclusion, **quand** l'utilisateur la colle, **alors** l'import isole le JSON et l'analyse sans erreur.
2. **IMP-06** — **Étant donné** un JSON dont `version_format` vaut « 2.0 », **quand** il est analysé, **alors** il est refusé en entier, rien n'est enregistré, et le message invite à régénérer le prompt.
3. **IMP-07** — **Étant donné** la demande du joueur B ouverte, **quand** l'utilisateur y colle un résultat dont la référence et l'identifiant désignent le joueur A, **alors** rien n'est enregistré et l'application propose d'ouvrir la demande du joueur A.
4. **IMP-05** — **Étant donné** un résultat coupé au milieu du 38e événement, dont l'en-tête est complet et les 37 premiers événements sont complets et triés, **quand** il est analysé, **alors** l'aperçu propose de récupérer 37 événements, ramène la période couverte à la veille de la date publique du 37e, et annonce la perte des pistes et des limites.
5. **IMP-11** — **Étant donné** un événement d'un type retiré depuis la création de la demande, **quand** le résultat est analysé, **alors** cet événement est ignoré avec le motif « type non validé à ce jour », n'entre pas dans les refus restants, et les autres événements restent acceptables.
6. **IMP-12, IMP-20** — **Étant donné** un 4e événement daté du 2021-02-30, **quand** le résultat est analysé, **alors** cet événement est refusé, et le message désigne le 4e événement, dit que la date n'existe pas et rappelle le format attendu.
7. **IMP-14** — **Étant donné** un événement à deux sources, dont l'une a pour lien « www.media-national.example » sans chemin ni « https:// », **quand** le résultat est analysé, **alors** cette source n'est pas retenue et l'événement est accepté avec un avertissement ; si aucune source exploitable ne reste, l'événement est refusé.
8. **IMP-14** — **Étant donné** un événement dont une source est datée cinq jours avant sa date publique, **quand** le résultat est analysé, **alors** l'événement est refusé avec un message qui demande de corriger la date publique ou de retirer la source.
9. **IMP-18** — **Étant donné** des dates de matchs connues et un événement dont toutes les sources sont publiées après le coup d'envoi de son match mesuré, **quand** l'import est confirmé, **alors** l'événement est enregistré, marqué « antériorité non établie », et ne produit aucun cas compté.
10. **IMP-18** — **Étant donné** que le calendrier du joueur est indisponible, **quand** l'import est confirmé, **alors** les événements sont marqués « antériorité à vérifier », puis classés dès que le calendrier est disponible, avant tout calcul.
11. **IMP-22** — **Étant donné** un résultat de 16 événements, dont 10 valides, 2 valides avec avertissement, 3 doublons et 1 refusé, **quand** l'aperçu s'affiche, **alors** il annonce 12 événements ajoutés dont 2 avec avertissement, 3 doublons et 1 refus, et donne la répartition par saison, saisons à zéro comprises.
12. **IMP-24, IMP-30** — **Étant donné** un aperçu comportant un refus, **quand** l'utilisateur confirme l'avertissement d'import partiel puis enregistre, **alors** les événements acceptés sont enregistrés, la demande passe à « importée » et affiche un refus restant.
13. **IMP-26** — **Étant donné** un événement historique enregistré de type « humiliation-publique » daté du 2021-01-14, **quand** un nouveau résultat contient le même type daté du 2021-01-15 avec une source nouvelle, **alors** l'événement n'est pas ajouté par défaut, sa source nouvelle est rattachée à l'existant, et l'utilisateur peut choisir « événements distincts ».
14. **IMP-27** — **Étant donné** un événement détecté à l'état « détecté » (lot 2), **quand** un résultat contient un événement qui lui correspond, **alors** celui-ci n'est pas ajouté et l'événement détecté reste inchangé ; si l'événement détecté est « écarté », l'événement du résultat n'est pas ajouté non plus, et l'aperçu indique que le fait se rétablit en réintégrant l'événement détecté (DET-45).
15. **IMP-28** — **Étant donné** un résultat déjà importé, **quand** l'utilisateur le colle de nouveau en mode complément, **alors** l'aperçu annonce « aucun événement nouveau » et l'enregistrement ne change aucun événement.
16. **IMP-29** — **Étant donné** 20 événements historiques importés du joueur A, dont 2 corrigés à la main, tous compris dans la couverture d'un nouveau résultat, **quand** l'utilisateur choisit le remplacement, **alors** l'aperçu annonce 20 suppressions dont 2 événements corrigés, demande une confirmation distincte, et ne touche aucun événement détecté.
17. **IMP-16** — **Étant donné** un événement qui porte un champ non prévu contenant des points marqués, **quand** l'import est confirmé, **alors** ce champ n'est pas enregistré et l'aperçu l'a signalé.
18. **IMP-08** — **Étant donné** une demande annulée, **quand** l'utilisateur y importe un résultat et confirme l'avertissement, **alors** la demande passe à « importée ».
19. **IMP-32** — **Étant donné** un événement historique, **quand** l'utilisateur change sa date publique, **alors** les contrôles de date s'appliquent, la correction est tracée sans l'ancienne valeur, l'antériorité est recalculée et le profil recalculé.
20. **IMP-33** — **Étant donné** un événement historique, **quand** l'utilisateur veut le supprimer, **alors** l'application exige un motif et rappelle qu'on ne supprime jamais un événement à cause du match qui l'a suivi.
21. **IMP-34** — **Étant donné** que le quota de la source de statistiques est atteint, **quand** l'utilisateur confirme un import, **alors** les événements sont enregistrés, la demande passe à « importée », et les cas attendent la reprise des statistiques.
22. **IMP-03** — **Étant donné** un aperçu affiché, **quand** l'application est fermée avant la confirmation, **alors** rien n'est enregistré dans les données de l'application, et le texte collé ne subsiste, au plus, que dans le brouillon d'import des documents 12 et 13 (IHM-42, DSN-32).
23. **IMP-11** — **Étant donné** les types T1 et T2 fusionnés dans T1 après la création de la demande, **quand** le résultat contient un événement de type T2, **alors** il est rattaché à T1 avec un avertissement ; **étant donné** un type T3 scindé en T4 et T5, **quand** le résultat contient un événement de type T3, **alors** l'aperçu demande de choisir entre T4 et T5, ou d'ignorer l'événement.
24. **IMP-13** — **Étant donné** une description qui reproduit des propos entre guillemets, **quand** le résultat est analysé, **alors** l'événement est refusé et le message de correction demande de résumer les propos sans guillemets.
25. **IMP-14** — **Étant donné** un événement dont la seule source est un message publié sur un réseau social, **quand** le résultat est analysé, **alors** cette source n'est pas retenue et l'événement est refusé faute de source exploitable.
26. **IMP-25** — **Étant donné**, au lot 2, un événement détecté de type « humiliation-publique » pour le joueur A, de date de référence 2026-03-01, **quand** un résultat contient pour A un événement de type « tourmente-mediatique » daté du 2026-03-02, **alors** l'aperçu présente un doublon possible et l'enregistrement attend la réponse de l'utilisateur ; s'il indique qu'il s'agit du même fait, l'événement du résultat n'est pas ajouté et l'événement détecté reste inchangé.
27. **IMP-36** — **Étant donné**, au lot 2, un événement détecté pour le joueur A dont le match mesuré commence dans 10 heures, **quand** l'utilisateur confirme l'import du premier résultat de recherche de A, **alors** la fiche d'alerte de cet événement est produite selon le document 09, et le pronostic de son cas suivi reste calculé sur les seuls cas historiques.
28. **IMP-37** — **Étant donné** un événement historique retiré, **quand** un nouvel import le rapporte de nouveau et que l'utilisateur choisit dans l'aperçu de ne pas l'enregistrer pour donnée sensible, **alors** il n'est pas enregistré et le compteur des événements retirés augmente d'une unité ; aucun autre motif ne permet ce choix.
29. **IMP-18** — **Étant donné** un événement enregistré avec l'antériorité « à vérifier », **quand** le profil du joueur est calculé, **alors** cet événement ne produit aucun cas compté tant que son antériorité reste « à vérifier ».

## Dépendances

- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : format du résultat et sa version ; nombre maximal de sources ; états de la demande ; couverture ; compléments.
- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : liste des types et leur état au moment de l'import ; types fusionnés, scindés ou retirés (TAX-27 à TAX-31) ; version de fiche (TAX-23).
- [03 — Collecte des actualités](03-collecte-des-actualites.md) : nettoyage des liens, repris pour comparer les sources (COL-28).
- [04 — Détection des événements](04-detection-des-evenements.md) : événements détectés et leur état, pour les doublons (lot 2) ; reconnaissance, à la détection, d'un fait déjà importé (DET-58).
- [07 — Statistiques de match](07-statistiques-de-match.md) : dates des matchs et heures de coup d'envoi, premier match NBA, saisons, récupération des statistiques et quotas.
- [08 — Sensibilité et verdict](08-sensibilite-et-verdict.md) : match mesuré, cas, aucun cas compté pour une antériorité non établie ou à vérifier, sort de l'antériorité incertaine, refus restants affichés à côté du profil, recalcul.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : fiche d'alerte produite après un import fait avant le coup d'envoi (ALE-05, H-ALE-03).
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : distinction entre cas suivis et cas historiques (SUI-05, SUI-07) ; pronostic figé (SUI-08, SUI-09).
- [12 — Interface et accès](12-interface-et-acces.md) : écran d'import, brouillon d'import (IHM-42), « Copier le message de correction » (IHM-43), aperçu, fiche d'événement, historique des imports.
- [13 — Données sensibles](13-donnees-sensibles.md) : relecture des descriptions et contrôles automatiques (DSN-24), sources admises (DSN-01, DSN-03), longueur maximale d'une description (DSN-20), retrait d'un événement et compteur des retraits (DSN-26 à DSN-29), conservation minimale.
- [14 — Exigences transverses](14-exigences-transverses.md) : paramètres, journal de l'application, quotas.
- [90 — Journal des décisions](90-journal-des-decisions.md) : source de vérité.

## Hypothèses et questions ouvertes

Renvois au journal :

- H-01, H-02, H-05, H-07, H-08, H-09 et H-12 sont appliquées telles quelles et restent, comme toute hypothèse du journal, à confirmer.
- Q-02 : aucun service n'est nommé ; la vérification d'accessibilité des liens ne suppose aucun outil particulier.

Hypothèses locales, toutes à confirmer :

- **H-IMP-01 — Politique de refus.** Un événement n'est refusé que pour un défaut que l'IA peut corriger et sans lequel il est inutilisable ou invérifiable : type absent ou inconnu, date publique invalide, description absente, trop longue ou entre guillemets, aucune source exploitable, dates incohérentes. Ce qui sort du champ de la demande est ignoré ; le reste donne un avertissement et une valeur par défaut. *À confirmer.*
- **H-IMP-02 — Valeurs par défaut des paramètres.** Taille maximale du texte collé : 2 Mo ; écart maximal entre dates publiques de deux événements correspondants : 2 jours ; avance tolérée d'une source sur la date publique, pour absorber les décalages horaires : 1 jour ; nombre de sources proposées au sondage : 3 ; vérification d'accessibilité des liens : activée. Paramétrables. *À confirmer.*
- **H-IMP-03 — Règle de correspondance.** Même type et dates publiques proches, ou lien commun après nettoyage ; types différents et dates proches d'un événement déjà enregistré : doublon possible, tranché par l'utilisateur ; le choix final revient à l'utilisateur dans l'aperçu. *À confirmer.*
- **H-IMP-04 — Récupération d'un résultat coupé.** Les événements complets d'un résultat coupé sont récupérables si l'en-tête est lisible et la liste triée ; la période couverte s'arrête alors la veille du dernier événement récupéré. *À confirmer.*
- **H-IMP-05 — Demande annulée.** Un résultat qui référence une demande annulée s'importe après confirmation, et la demande passe à « importée », pour ne pas perdre une recherche déjà menée. *À confirmer.*
- **H-IMP-06 — Modes d'import.** Le complément est le mode par défaut ; le remplacement ne supprime que des événements historiques issus d'imports, dans les types et la période couverts par le nouveau résultat, et jamais un événement détecté. *À confirmer.*
- **H-IMP-07 — Antériorité non établie.** Un événement sans source antérieure au match mesuré est conservé, pour que le comptage reste exhaustif, mais ne produit aucun cas compté, plutôt que d'être refusé. *À confirmer.*
- **H-IMP-08 — Accessibilité des liens.** L'application tente d'ouvrir chaque lien après l'enregistrement et signale les pages introuvables, sans blocage ni suppression. *À confirmer.*
- **H-IMP-09 — Sondage facultatif.** Le sondage des sources est proposé mais jamais imposé avant l'enregistrement. *À confirmer.*
- **H-IMP-10 — Conservation minimale.** Le texte collé n'est gardé que comme brouillon d'import (documents 12 et 13, IHM-42, DSN-32), jamais avec les données enregistrées ; des pistes non vérifiées, seul le nombre par type est conservé ; la précision du contexte est montrée dans l'aperçu sans être conservée ; les limites sont conservées en texte dans la trace. À valider au regard du document 13. *À confirmer.*
- **H-IMP-11 — Motifs de suppression.** Liste fermée de motifs ; un effacement pour une raison de sensibilité relève du retrait du document 13, et non d'une suppression. *À confirmer.*
- **H-IMP-12 — Refus restants.** Les refus restants d'une demande sont ceux de son dernier import. *À confirmer.*
- **H-IMP-13 — Domaines non admis.** Une liste paramétrable de domaines (réseaux sociaux, forums, encyclopédies collaboratives, plateformes de vidéo) permet de ne pas retenir d'office les sources que le document 13 n'admet pas ; les spécifications n'y nomment aucun service, et son contenu initial est établi à la conception technique. *À confirmer.*

Questions ouvertes locales :

- **Q-IMP-01 — Antériorité incertaine.** Un événement dont la plus ancienne source date du jour du match mesuré, sans heure, doit-il produire un cas douteux, un cas valide, ou être mesuré sur le match suivant ? À trancher avec le document 08, dont la réponse par défaut, à confirmer, est de réputer la source publiée en fin de journée, heure de la côte Pacifique, et de mesurer le cas sur le match suivant, avec la mention « antériorité incertaine » (SEN-44).
- **Q-IMP-02 — Ajout manuel d'un événement.** Faut-il permettre à l'utilisateur d'ajouter à la main un événement historique que le backtest n'a pas trouvé ? Ce document ne le prévoit pas : un tel ajout risquerait de réintroduire les exemples marquants que D-32 et H-01 cherchent à neutraliser.
