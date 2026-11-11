# 11 — Notifications Telegram

## Objet

Egoscope prévient son utilisateur unique par des messages Telegram (D-30) quand un fait demande son attention : un backtest à lancer avant un match, une alerte pour un joueur profilé, le résultat d'un match suivi, un nouveau type proposé, un incident. Ce document fixe le catalogue des messages (déclencheur, contenu, lien de retour, exemple), les règles de sobriété, les réglages par catégorie, la première mise en relation avec le compte Telegram de l'utilisateur et le traitement des échecs d'envoi. Une notification n'est jamais qu'une copie : tout ce qu'elle annonce reste consultable dans l'application. Les notifications arrivent au lot 2 (H-12).

## Décisions d'origine

- **D-30** — Les notifications sont envoyées sur Telegram.
- **D-02** — Un seul utilisateur.
- **D-07 bis** — Gratuité totale, services compris : le canal de notification ne doit rien coûter.
- **D-08**, **Q-05** — Aucun pari, aucune cote.
- **D-12** — Tout nouveau type doit être validé par l'utilisateur.
- **D-15** — Balayage quotidien planifié : la plupart des messages naissent de tâches planifiées.
- **D-20** — Stockage minimal, aucun détail intime.
- **D-24**, **D-36** — Un joueur détecté sans backtest fait l'objet d'une demande ; le match peut être joué avant que le backtest soit prêt, d'où l'importance de l'échéance.
- **D-25** — Application web installable, vers laquelle pointent les liens.
- **D-29** — Fiche d'alerte pour un joueur profilé, puis suivi automatique du résultat.
- **D-35** — Pas de critère d'arrêt, mais un tableau de validation honnête, nourri par les résultats suivis.
- **H-07** — La demande de backtest affiche l'échéance du prochain match.
- **H-08** — Aucune validation de l'événement n'est exigée avant l'alerte.
- **H-11** — Langue française.
- **H-12** — Telegram appartient au lot 2.

## Périmètre

Ce document couvre :

- les principes du canal : copie, sens unique, contenu minimal, lien de retour ;
- le catalogue des messages ;
- la sobriété : un fait un message, regroupement, plage de silence, urgence, plafond ;
- l'activation et la désactivation par catégorie ;
- la mise en relation avec le compte Telegram ;
- les échecs d'envoi et la reprise.

Il ne couvre pas :

- la naissance des faits notifiés : décision d'alerte et propositions de type issues de la détection ([04 — Détection des événements](04-detection-des-evenements.md)), demande de backtest et échéance ([05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md)), fiche d'alerte ([09 — Fiche d'alerte](09-fiche-d-alerte.md)), résultat suivi ([10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md)), cycle de vie des types ([02 — Taxonomie des événements](02-taxonomie-des-evenements.md)) ;
- la détection des incidents : pannes de source ([03 — Collecte des actualités](03-collecte-des-actualites.md)), source de statistiques et son quota ([07 — Statistiques de match](07-statistiques-de-match.md)), quota de classification ([04 — Détection des événements](04-detection-des-evenements.md)), quotas en général ([14 — Exigences transverses](14-exigences-transverses.md)) ;
- les écrans visés par les liens et l'écran des réglages : [12 — Interface et accès](12-interface-et-acces.md) ;
- les règles de fond sur les données sensibles : [13 — Données sensibles](13-donnees-sensibles.md) ;
- la création du robot Telegram de l'application pendant l'installation : [14 — Exigences transverses](14-exigences-transverses.md).

## Acteurs et déclencheurs

Acteurs :

- l'utilisateur, qui reçoit les messages dans une conversation privée avec le robot Telegram de l'application, le plus souvent sur son téléphone ;
- l'application, qui compose et envoie les messages et garde la trace de chaque envoi ;
- Telegram, qui transporte les messages.

Le **robot** est le compte Telegram automatique propre à l'application (un « bot » dans le vocabulaire de Telegram). Il est créé une fois pour toutes pendant l'installation (document 14).

Un **passage** est une exécution d'une tâche planifiée (document 14), par exemple la collecte et la détection du jour, ou la récupération des statistiques après les matchs.

Déclencheurs :

- la création ou la mise à jour, dans l'application, d'un fait du catalogue (TEL-09 à TEL-16) ;
- la fin de la plage de silence, qui libère les messages différés ;
- l'approche de l'échéance d'une demande de backtest, pour le rappel ;
- le retour de Telegram après un échec d'envoi, pour le rattrapage ;
- la demande de mise en relation faite par l'utilisateur dans les réglages.

## Parcours

Scénario nominal :

1. Un fait du catalogue naît dans l'application, par exemple une fiche d'alerte (document 09).
2. L'application vérifie que la conversation est reliée, que les notifications et la catégorie du fait sont activées, et que ce fait n'a pas déjà été notifié.
3. Elle compose le message en français selon le catalogue, avec un lien vers l'écran concerné.
4. Elle applique les règles de sobriété : regroupement avec les autres messages du même passage, plage de silence, urgence, plafond quotidien.
5. Elle envoie le message et enregistre son statut.
6. L'utilisateur lit le message et touche le lien ; l'application s'ouvre sur l'écran concerné, après authentification si nécessaire (document 12).

Variantes :

- **Plage de silence** : le message est différé, puis part à la fin de la plage avec les autres messages différés.
- **Urgence pendant la plage de silence** : le message part tout de suite, seul, marqué « urgent ».
- **Catégorie désactivée** : rien ne part ; le fait reste visible dans l'application.
- **Échec d'envoi** : nouvelles tentatives, puis un message de rattrapage quand Telegram répond de nouveau.
- **Première mise en relation** :
  1. Dans les réglages des notifications, l'utilisateur touche « Relier Telegram ».
  2. L'application affiche un bouton « Ouvrir Telegram », valable quelques minutes.
  3. Telegram s'ouvre sur la conversation avec le robot ; l'utilisateur touche « Démarrer ».
  4. Le robot répond par un message de confirmation ; l'application affiche « Telegram relié » et propose un message d'essai.

## Règles de gestion

### Principes

- **TEL-01** [Lot 2] — Telegram est le seul canal de notification (D-30, H-TEL-02). Les messages partent dans une seule conversation privée, celle qui a été reliée (TEL-29) ; rien n'est envoyé ailleurs, jamais à un groupe ni à un canal (DSN-31).
- **TEL-02** [Lot 2] — **Une notification est une copie.** Chaque message est composé à partir d'un fait enregistré dans l'application (demande, fiche, cas, type, incident). Ce fait reste consultable dans l'application, que le message soit envoyé, différé, regroupé, abandonné ou perdu. Aucune information n'existe seulement dans Telegram, et le journal d'activité garde la trace de chaque message (TEL-34).
- **TEL-03** [Lot 2] — **Sens unique.** Les messages informent et renvoient vers l'application ; aucune action (écarter un événement, valider un type, importer un résultat) ne se fait depuis Telegram, et le robot ne traite aucune commande en dehors de la mise en relation (H-TEL-01).
- **TEL-04** [Lot 2] — **Langue et heures.** Les messages sont en français (H-11). Dates et heures sont données dans le fuseau horaire de l'utilisateur (réglage IHM-14 du document 12), dont le nom est rappelé (« heure de Paris »), avec la date du match aux États-Unis quand elle diffère.
- **TEL-05** [Lot 2] — **Aucun pari.** Aucun message ne contient de cote, de mise, de pronostic sur un match à venir, de conseil de pari ni de phrase au futur sur la performance attendue (D-08, Q-05). Le mot « pronostic » n'apparaît que dans la mention finale des alertes, « Mesure du passé, pas un pronostic. », et, dans un résultat de match suivi, dans les termes du document 10 (pronostic figé, pronostic tardif, sans pronostic).
- **TEL-06** [Lot 2] — **Contenu minimal.** Un message ne contient jamais plus que ce que l'application stocke, et en pratique moins (D-20, document 13) : ni extrait d'article, ni citation, ni description de l'événement, ni détail intime (H-TEL-05). Un événement y est désigné par son joueur, le nom de son type et sa source (média, date et heure), sauf un événement d'un type dont la fiche porte la mention « sujet intime » (TAX-01), désigné comme « événement sensible » sans que le type soit nommé (DSN-35). La première ligne, souvent visible sur l'écran verrouillé du téléphone, se limite à la catégorie et au sujet.
- **TEL-07** [Lot 2] — **Lien de retour.** Chaque message comporte au moins un lien vers l'écran précis concerné, indiqué pour chaque message du catalogue. Le lien ne contient aucun secret et ne donne accès à rien sans authentification ; après connexion, l'utilisateur arrive sur l'écran visé (document 12). Si le fait n'existe plus (événement écarté ou retiré, demande annulée), l'écran explique ce qu'il est devenu.
- **TEL-08** [Lot 2] — **Forme.** Une première ligne « Egoscope · catégorie — sujet », puis les faits essentiels, une idée par ligne, puis le ou les liens. Les messages restent courts ; aucun nom de fournisseur n'y apparaît, les services étant désignés par leur fonction (Q-02).

### Catalogue des messages

Chaque message est décrit par son déclencheur, son contenu et son lien, suivis d'un exemple fictif ; le fuseau de l'utilisateur y est l'heure de Paris.

#### Demande de backtest à faire

- **TEL-09** [Lot 2] — Déclencheur : une demande acquiert une échéance du fait d'une détection, pour un joueur non profilé au sens du glossaire du document 00 (BKT-03) : à sa création, ou quand le document 05 rattache un nouvel événement détecté à une demande existante et en modifie l'échéance (message « échéance modifiée »). Un nouvel événement qui ne change pas l'échéance ne produit pas de message. Le complément né d'une détection pour un joueur profilé (BKT-04) est annoncé dans le message d'alerte (TEL-11), sans message séparé. Les demandes créées par l'utilisateur, manuelles ou complémentaires, ne sont pas notifiées (TEL-18).
  - Contenu : joueur et équipe ; mention « pas encore de backtest » ; type de l'événement à l'origine, avec le média, la date et l'heure de la source ; échéance au sens de BKT-18 : date et heure du match attendu de l'événement, adversaire, temps restant ; rappel que le prompt est prêt. Si le coup d'envoi est déjà passé au moment de l'envoi : « le match a commencé ; la demande reste utile pour le profil ».
  - Lien : écran de la demande de backtest, où se trouve le bouton « Copier le prompt ».

> **Egoscope · Backtest à faire — le joueur B**
>
> Le joueur B (équipe Z) n'a pas encore de backtest. Événement détecté : « Conflit entre joueurs » (un média national, lun. 16 nov. à 14 h 20).
>
> Échéance : match attendu jeu. 19 nov. à 2 h 00, heure de Paris (mercredi soir aux États-Unis), contre l'équipe X, dans 42 h. Le prompt de recherche est prêt.
>
> Ouvrir la demande (lien)

#### Rappel avant échéance

- **TEL-10** [Lot 2] — Déclencheur : une demande née d'une détection est toujours « à faire » à un délai donné avant le coup d'envoi de son échéance (paramétrable, 6 h par défaut, H-TEL-03). Un seul rappel par demande et par échéance ; le rappel se désactive à part (TEL-24).
  - Contenu : joueur ; échéance ; conséquence : sans import avant le coup d'envoi, aucune fiche d'alerte ne sera produite pour ce match, mais l'événement sera suivi (H-07, D-36).
  - Lien : écran de la demande.

> **Egoscope · Rappel — backtest du joueur B toujours à faire**
>
> Match dans 6 h : jeu. 19 nov. à 2 h 00, heure de Paris, contre l'équipe X. Sans import avant le coup d'envoi, pas de fiche d'alerte pour ce match ; l'événement sera tout de même suivi.
>
> Ouvrir la demande (lien)

#### Alerte pour un joueur profilé

- **TEL-11** [Lot 2] — Déclencheur : production d'une fiche d'alerte (document 09), tardive comprise. Pour une fiche produite avant la fin du calcul du profil (ALE-05), le message part quand les valeurs du profil y entrent.
  - Contenu : joueur ; type et source de l'événement (média, date et heure) ; profil pour ce type tel que figé dans la fiche : écart normalisé moyen avec sa fourchette (SEN-38), nombre de cas valides avec la répartition historiques et suivis, verdict, sens et confiance du profil ; sous le seuil, « non concluant pour ce joueur (k cas valides sur 5 nécessaires) », suivi de la tendance générale du type, présentée comme telle, avec son nombre de cas (SEN-31) ; match attendu de la fiche (date, heure, adversaire, ALE-15) ; intitulés des réserves ; marque « tardive » le cas échéant ; mention finale de TEL-05. Si la fiche porte la mention « type non couvert par le backtest » et signale une demande complémentaire (ALE-14), le message le dit, sans message séparé.
  - Lien : écran de la fiche d'alerte.
  - Les alertes au verdict « non concluant » sont notifiées par défaut ; l'utilisateur peut les exclure (TEL-24). Elles restent produites et visibles.

> **Egoscope · Alerte — le joueur A**
>
> Événement : « Humiliation publique » (un média national, lun. 16 nov. à 23 h 40).
>
> Profil pour ce type : +0,83 sur 7 cas valides (5 historiques, 2 suivis), fourchette de +0,07 à +1,59. Verdict : possible, en hausse. Confiance du profil : faible.
>
> Match attendu : mer. 18 nov. à 1 h 30, heure de Paris, contre l'équipe X. Réserves : petit échantillon ; sens de l'effet.
>
> Voir la fiche n° 14 (lien)
>
> Mesure du passé, pas un pronostic.

Variante urgente (TEL-21) : la première ligne devient « Egoscope · Alerte urgente — le joueur A », suivie de « Le match commence avant la fin de votre plage de silence. »

#### Mise à jour d'une alerte

- **TEL-12** [Lot 2] — Déclencheur : un changement utile d'une fiche encore ouverte, connu avant le coup d'envoi : nouvel événement avant le même match (ALE-20) ou changement du match attendu (ALE-23). Ne produisent pas de message : une nouvelle source (ALE-21), un recalcul du profil, et toute action de l'utilisateur (événement écarté ou réintégré, rattachement ou contexte corrigé, retrait).
  - Contenu : ce qui change, en une ou deux lignes, et l'état de la fiche.
  - Lien : écran de la fiche d'alerte.

> **Egoscope · Mise à jour — alerte du joueur E**
>
> Le match du sam. 21 nov. contre l'équipe X est reporté. Match attendu : lun. 23 nov. à 1 h 00, heure de Paris, contre l'équipe W.
>
> Voir la fiche n° 15 (lien)

#### Résultat d'un match suivi

- **TEL-13** [Lot 2] — Déclencheur : le document 10 transmet un résultat de match suivi (SUI-19), quand un cas suivi devient mesuré, exclu ou non mesurable, y compris pour un joueur non profilé (H-07), ou quand un résultat indicatif est communiqué alors que la référence est en constitution (SUI-20).
  - Contenu : joueur ; match (date, adversaire) ; écart normalisé obtenu, avec la mention « provisoire » ou « indicatif » s'il y a lieu (SUI-15, SUI-20), ou motif d'exclusion ou de non-mesure ; catégorie du cas avec les termes du document 10 (SUI-22) ; mentions « enregistré après le coup d'envoi, ne compte pas comme test » ou « pronostic tardif » le cas échéant ; nouvelles valeurs du profil (écart moyen, fourchette et nombre de cas) et changement éventuel de verdict ; pour un joueur non profilé, « pas encore de backtest : ce cas compte déjà dans son profil, qui ne repose que sur ses cas suivis ».
  - Un changement d'écart ou de catégorie après l'envoi (SUI-21) ne produit pas de nouveau message (TEL-17) ; il se lit dans l'application.
  - Lien : la fiche d'alerte et son issue si elle existe, sinon le détail du cas dans le profil ; un lien vers le tableau de validation termine le message.
  - Tous les résultats d'un même passage de récupération des statistiques forment un seul message (TEL-19).

> **Egoscope · Résultats de 2 matchs suivis**
>
> Le joueur A, mer. 18 nov. contre l'équipe X : +1,07, provisoire, cas confirmé (un cas isolé ne prouve rien). Profil : +0,86 sur 8 cas valides, fourchette de +0,15 à +1,57, verdict inchangé. Voir la fiche n° 14 (lien)
>
> Le joueur D, mer. 18 nov. contre l'équipe W : −0,35, sans pronostic. Pas encore de backtest : ce cas compte déjà dans son profil, qui ne repose que sur ses cas suivis. Voir le cas (lien)
>
> Tableau de validation (lien)

#### Proposition de nouveau type à valider

- **TEL-14** [Lot 2] — Déclencheur : la détection transmet une proposition de nouveau type, enregistrée à l'état « proposé » (documents 04 et 02). Une occurrence ajoutée à une proposition en attente, à un type rejeté ou à un type retiré ne produit pas de message (TAX-18). Les propositions issues du prompt d'exploration lancé par l'utilisateur ne sont pas notifiées (TEL-18).
  - Contenu : nom proposé, définition en une phrase, nombre d'articles à l'origine, date ; rappel qu'un type proposé n'est utilisé qu'une fois validé (D-12).
  - Lien : fiche du type proposé, avec les actions valider et rejeter.

> **Egoscope · Nouveau type proposé**
>
> « Rétrogradation sur le banc » : perte publique de la place de titulaire. Proposé par la détection du mar. 17 nov. à partir de 3 articles. Il ne sera utilisé qu'après votre validation.
>
> Valider ou rejeter (lien)

#### Incidents

- **TEL-15** [Lot 2] — Déclencheur : le document responsable déclare le début ou la fin d'un incident : source de presse en panne et collecte impossible (COL-41, COL-44), quota d'un service gratuit atteint (DET-11, STA-39, TRV-05), source de statistiques indisponible (STA-37), tâche non exécutée (TRV-31), sauvegarde en échec (TRV-50). L'avertissement « source muette » (COL-42) suit les mêmes règles que ces incidents, car une source muette peut faire manquer des événements (H-01), et le rappel d'export (TRV-54) donne un seul message par rappel, sans répétition tant qu'aucun export n'a été fait (H-TEL-07). Le présent document ne définit pas quand un incident commence ou finit.
  - Contenu : nature de l'incident, désignée par la fonction touchée ; depuis quand ; ce qui est touché et la conséquence pour l'utilisateur (événements peut-être manqués, résultats ou calculs en attente) ; ce que fait l'application (nouvel essai, reprise au prochain passage) ; ce que l'utilisateur peut faire, s'il y a lieu.
  - Lien : écran des sources de presse pour une source en panne ; journal d'activité, filtré sur l'incident, dans les autres cas.
  - Cycle : un message au début ; un rappel si l'incident dure (paramétrable, tous les 3 jours, H-TEL-03) ; un message court à la fin, si le début a été notifié. Un incident qui cesse puis reprend dans un délai court (paramétrable, 6 h) n'est pas notifié de nouveau. Plusieurs incidents de même nature au même moment, par exemple plusieurs sources en panne, forment un seul message.
  - Le blocage de la connexion après des échecs répétés (TRV-61) suit les mêmes règles, comme incident de sécurité (H-TEL-06).

> **Egoscope · Incident — source de presse en panne**
>
> La source « un média national, rubrique NBA » ne répond plus depuis lun. 16 nov. à 7 h 00. Les autres sources fonctionnent. Des événements peuvent manquer à la détection tant que la panne dure.
>
> Voir les sources (lien)

> **Egoscope · Incident — quota de classification atteint**
>
> La détection du mar. 17 nov. s'est arrêtée après 140 articles sur 210. Les articles restants seront traités au prochain passage, selon les règles de la détection.
>
> Voir le journal (lien)

> **Egoscope · Incident — statistiques indisponibles**
>
> La source de statistiques ne répond plus depuis jeu. 19 nov. à 6 h 10. En attente : le résultat du match suivi du joueur B et le calcul du profil du joueur C. Nouvel essai automatique.
>
> Voir le journal (lien)

> **Egoscope · Incident résolu — statistiques**
>
> La source de statistiques répond de nouveau, après 5 h 40 d'interruption. Les résultats et calculs en attente ont repris.

#### Messages de service

- **TEL-16** [Lot 2] — Messages qui ne relèvent d'aucune catégorie : confirmation de mise en relation et message d'essai (TEL-29), message groupé de fin de plage de silence (TEL-20), message de rattrapage (TEL-36), message de plafond atteint (TEL-22), avis envoyé à une conversation qui n'est plus reliée (TEL-30). Ils ne se désactivent pas par catégorie ; l'interrupteur général (TEL-25) les coupe, sauf la confirmation de mise en relation, toujours envoyée.

> **Egoscope · Pendant la plage de silence (23 h – 8 h)**
>
> Résultat suivi — le joueur F, jeu. 26 nov. contre l'équipe V : +0,21. Voir le cas (lien)
>
> Incident — source de presse en panne : « un quotidien régional » ne répond plus depuis jeu. 26 nov. à 4 h 00. Voir les sources (lien)
>
> Tout est dans l'application (lien vers l'accueil)

> **Egoscope est relié à cette conversation.**
>
> Vous recevrez ici les notifications activées dans les réglages. Rien ne se fait depuis Telegram : chaque message contient un lien vers l'application.

### Sobriété

- **TEL-17** [Lot 2] — **Un fait, un message.** Chaque fait n'est notifié qu'une fois ; seuls les changements prévus en TEL-09 et TEL-12 donnent lieu à un nouveau message. Un fait inclus dans un message groupé n'est pas renvoyé seul. Une reprise après échec ne renvoie jamais un message dont l'envoi a été confirmé.
- **TEL-18** [Lot 2] — **Pas de notification de ses propres actions.** Ce qui découle immédiatement d'une action de l'utilisateur dans l'application n'est pas notifié : demande créée à la main ou complémentaire, propositions issues de son prompt d'exploration, événement écarté ou réintégré, rattachement corrigé, y compris la fiche qui en naît (ALE-31), retrait, type validé, réglage modifié. Une fiche d'alerte née d'un import (ALE-05) est notifiée, car les valeurs de son profil peuvent n'arriver que bien après l'import.
- **TEL-19** [Lot 2] — **Regroupement par passage.** Les messages nés d'un même passage partent en un seul message groupé, avec une ligne et un lien par fait. Les alertes font exception : chacune part dans son propre message tant que le passage n'en produit pas plus qu'un seuil (paramétrable, 3 par défaut, H-TEL-03) ; au-delà, elles sont groupées elles aussi. Un message groupé détaille au plus un nombre de faits (paramétrable, 10 par défaut) et résume le reste (« et 4 autres ») avec un lien vers l'accueil.
- **TEL-20** [Lot 2] — **Plage de silence.** Pendant une plage horaire réglée par l'utilisateur dans son fuseau horaire (paramétrable, de 23 h à 8 h par défaut, H-TEL-03), aucun message ne part, sauf urgence (TEL-21). À la fin de la plage, les messages différés partent selon TEL-19, comme s'ils étaient nés d'un même passage ; le message groupé porte alors le titre « Pendant la plage de silence ». Ce réglage tient compte du décalage avec les États-Unis : la plupart des matchs NBA se jouent pendant la nuit européenne, et les passages qui suivent les matchs tombent souvent dans la plage.
- **TEL-21** [Lot 2] — **Urgence avant un match.** Un message est urgent quand il concerne un match qui n'a pas commencé et dont le coup d'envoi tombe avant la fin de la plage de silence en cours : différé, il arriverait trop tard. Seuls peuvent être urgents la demande de backtest (TEL-09), le rappel (TEL-10), l'alerte (TEL-11) et sa mise à jour (TEL-12). Un message urgent part aussitôt et seul, avec « urgent » dans sa première ligne. Cette exception est activée par défaut et peut être désactivée (H-TEL-03) ; désactivée, les urgences sont différées comme le reste.
- **TEL-22** [Lot 2] — **Plafond quotidien.** Au-delà d'un nombre de messages dans la journée (paramétrable, 20 par défaut, H-TEL-03), l'application n'envoie plus qu'un seul message « plafond atteint », qui invite à ouvrir l'application, puis plus rien jusqu'au lendemain, urgences comprises. Ce plafond protège contre un emballement ; son dépassement est inscrit au journal d'activité. La journée s'entend dans le fuseau de l'utilisateur.
- **TEL-23** [Lot 2] — **Obsolescence.** Au moment d'envoyer un message différé ou repris, l'application revérifie le fait. Un message devenu sans objet (demande importée ou annulée, événement écarté, fiche annulée, incident terminé avant l'envoi de son début) est abandonné. Un message encore utile dont le match a commencé part dans le message groupé avec la mention « après le coup d'envoi ».

### Réglages

- **TEL-24** [Lot 2] — **Activation par catégorie.** L'utilisateur active ou désactive chacune des cinq catégories : demandes de backtest (rappels compris), alertes (mises à jour comprises), résultats suivis, propositions de type, incidents. Toutes sont activées par défaut (H-TEL-03). Sous-options : rappel avant échéance (activé, délai réglable) ; alertes au verdict « non concluant » (notifiées) ; fin d'incident (notifiée).
- **TEL-25** [Lot 2] — **Interrupteur général.** Un réglage suspend toutes les notifications sans délier la conversation. À la réactivation, rien de ce qui s'est passé pendant la suspension n'est envoyé ; l'accueil de l'application le montre.
- **TEL-26** [Lot 2] — **Ce qui n'est pas notifié reste visible.** Désactiver une catégorie ne change rien dans l'application : demandes, alertes, résultats, propositions et incidents restent visibles dans l'accueil ou la liste « à faire » selon leur nature, dans leurs écrans et dans le journal d'activité (document 12). Les messages différés d'une catégorie que l'on désactive sont abandonnés.
- **TEL-27** [Lot 2] — Les réglages (catégories, sous-options, plage de silence, exception d'urgence, plafond, délais, seuils de regroupement) se modifient dans l'écran des réglages (document 12) ; chaque modification est inscrite au journal d'activité.

### Mise en relation avec Telegram

- **TEL-28** [Lot 2] — **Prérequis.** L'utilisateur a un compte Telegram et l'application dispose de son robot, créé pendant l'installation (document 14). Tant que la conversation n'est pas reliée, l'application fonctionne normalement et ses réglages indiquent « Telegram non relié ».
- **TEL-29** [Lot 2] — **Procédure.** « Relier Telegram » produit un code à usage unique, valable peu de temps (paramétrable, 15 minutes, H-TEL-03), porté par le bouton « Ouvrir Telegram ». Ce bouton ouvre la conversation avec le robot ; en touchant « Démarrer », l'utilisateur transmet le code. L'application relie alors cette conversation, l'affiche et envoie un message de confirmation. Seule une conversation privée entre l'utilisateur et le robot peut être reliée : un code transmis depuis un groupe ou un canal est refusé (DSN-31). Si le bouton ne peut pas ouvrir Telegram, par exemple sur un ordinateur qui n'en dispose pas, l'écran affiche le nom du robot et le code à lui envoyer. Un message d'essai peut être demandé à tout moment.
- **TEL-30** [Lot 2] — **Une seule conversation.** Relier une nouvelle conversation remplace l'ancienne, qui reçoit un dernier message « Cette conversation n'est plus reliée à Egoscope ». « Délier » arrête tout envoi.
- **TEL-31** [Lot 2] — **Robot fermé aux inconnus.** Un code expiré, déjà utilisé ou inconnu est refusé. En dehors d'un code de liaison valide (TEL-29), tout message d'une conversation non reliée est ignoré, sans réponse ni information (TRV-67) ; ces tentatives sont inscrites au journal d'activité.
- **TEL-32** [Lot 2] — **État visible.** Les réglages affichent l'état de la liaison (non reliée, en attente de confirmation, reliée depuis le…, rompue), la date du dernier envoi réussi et le nombre de messages en échec.

### Échec d'envoi et reprise

- **TEL-33** [Lot 2] — **Statuts.** Chaque message a un statut : à envoyer, différé, envoyé, regroupé, abandonné, en échec.
- **TEL-34** [Lot 2] — **Trace.** Le journal d'activité garde, pour chaque message, sa catégorie, les faits concernés, son statut, ses dates et le motif d'un échec (document 14) ; l'écran des réglages y donne un accès direct (document 12).
- **TEL-35** [Lot 2] — **Échec temporaire** (Telegram injoignable, réseau) : l'application réessaie à intervalles croissants (paramétrable, après 1, 5, 15, 30 et 60 minutes, H-TEL-03). Si Telegram demande de ralentir, elle attend le délai indiqué. Aucun service payant de secours n'est employé (D-07 bis).
- **TEL-36** [Lot 2] — **Rattrapage.** Après la dernière tentative, le message passe « en échec » et l'accueil de l'application affiche un bandeau. Dès qu'un envoi réussit de nouveau, un message de rattrapage unique récapitule les faits non reçus qui sont encore d'actualité (TEL-23), en indiquant la période concernée.
- **TEL-37** [Lot 2] — **Échec définitif** (robot bloqué par l'utilisateur, conversation supprimée, robot désactivé) : l'application cesse les tentatives, passe la liaison à « rompue » et le signale dans l'accueil et dans la liste « à faire » de l'application, seul endroit où cet incident peut apparaître ; il faut relier de nouveau (TEL-29).
- **TEL-38** [Lot 2] — **Événement écarté ou retiré.** Les messages en attente qui le concernent sont abandonnés. Les messages déjà reçus ne sont pas modifiés, sauf retrait au sens du document 13 : l'application tente alors de supprimer de la conversation les messages qui mentionnent l'événement ; ceux que Telegram ne permet plus de supprimer restent dans la conversation, comme l'annonce l'écran de retrait (DSN-28), et l'application les signale à l'utilisateur, qui peut les supprimer lui-même (H-TEL-04).

## Données manipulées

- **Liaison Telegram** : identifiant de la conversation reliée, date de liaison, état (non reliée, en attente de confirmation, reliée, rompue), date du dernier envoi réussi ; pendant la mise en relation, le code à usage unique et son heure d'expiration.
- **Message** : catégorie, faits concernés, texte envoyé, liens, caractère urgent ou non, date de création, dates d'envoi prévue et effective, statut, nombre de tentatives, motif du dernier échec, message groupé qui l'a inclus.
- **Réglages de notification** : interrupteur général, catégories et sous-options, plage de silence, exception d'urgence, plafond quotidien, délai du rappel, seuil de regroupement des alertes, nombre de faits détaillés par message groupé, intervalles de reprise, fréquence du rappel d'incident, délai de reprise d'un incident, durée de validité du code.
- Le texte des messages est conservé le temps prévu pour le journal (document 14) et effacé avec l'événement en cas de retrait (document 13).

## Cas limites et erreurs

- **Code de liaison expiré ou déjà utilisé** : refus ; l'écran propose un nouveau code.
- **Un inconnu trouve le robot** et lui écrit : TEL-31.
- **Code de liaison envoyé depuis un groupe** : refus (TEL-29).
- **Conversation supprimée ou robot bloqué** : TEL-37.
- **Telegram indisponible plusieurs heures** : TEL-35 et TEL-36 ; une urgence qui n'a pas pu partir figure dans le rattrapage, avec « après le coup d'envoi » si le match a commencé.
- **Plage de silence à cheval sur minuit** : elle forme une seule plage ; une plage dont le début égale la fin équivaut à aucune plage.
- **Changements d'heure**, qui ne tombent pas aux mêmes dates en Europe et aux États-Unis : les heures affichées et la plage suivent le fuseau de l'utilisateur ; l'urgence se juge sur des instants, pas sur des heures affichées.
- **Changement de fuseau par l'utilisateur** : la plage s'applique dans le nouveau fuseau dès la modification.
- **Fait modifié entre la création et l'envoi d'un message différé** : le message part avec l'état à jour, ou il est abandonné (TEL-23).
- **Fiche tardive** : jamais urgente ; la marque « tardive » figure dans le message.
- **Début de saison ou panne générale** qui produisent beaucoup de faits : TEL-19 et TEL-22.
- **Incident intermittent** : TEL-15.
- **Lien ouvert sur un appareil non connecté**, ou dans le navigateur plutôt que dans l'application installée : connexion, puis écran visé (document 12).
- **Message trop long pour Telegram** malgré TEL-19 : il est raccourci au profit d'un lien vers l'accueil, jamais coupé au milieu d'un fait.

## Critères d'acceptation

1. (TEL-02) Étant donné une alerte notifiée, quand l'utilisateur ouvre l'application sans passer par le message, alors il retrouve la fiche dans l'accueil et dans la liste des alertes.
2. (TEL-09) Étant donné un joueur non profilé, quand la détection crée pour lui une demande de backtest, alors un message part avec le type, la source, l'échéance (date, heure, adversaire, temps restant) et un lien vers la demande.
3. (TEL-18) Étant donné une demande créée à la main par l'utilisateur, quand elle est enregistrée, alors aucun message ne part.
4. (TEL-11, TEL-05) Étant donné une fiche d'alerte produite, quand le message part, alors il contient le joueur, le type, la source, l'écart moyen avec sa fourchette, son nombre de cas valides et leur répartition, le verdict, le sens, la confiance du profil, le match attendu, les réserves et la mention « Mesure du passé, pas un pronostic. », sans aucun terme de pari.
5. (TEL-06) Étant donné un événement de n'importe quel type, quand un message le mentionne, alors il ne contient ni extrait d'article ni description de l'événement, et sa première ligne se limite à la catégorie et au joueur ; étant donné un type marqué « sujet intime », alors le message parle d'un « événement sensible » sans nommer le type.
6. (TEL-20) Étant donné une plage de silence de 23 h à 8 h, quand trois résultats suivis sont produits à 6 h, alors aucun message ne part avant 8 h, puis un seul message groupé les présente.
7. (TEL-21) Étant donné cette plage et l'exception d'urgence activée, quand une fiche d'alerte est produite à 23 h 30 pour un match qui commence à 1 h 30, alors le message part aussitôt, seul, avec « urgent » en première ligne.
8. (TEL-21) Étant donné la même plage, quand une fiche est produite à 23 h 30 pour un match qui commence le lendemain à 20 h, alors le message attend 8 h.
9. (TEL-19) Étant donné un passage de détection qui produit deux demandes de backtest et une proposition de type, quand les messages partent, alors l'utilisateur reçoit un seul message groupé, avec un lien par fait.
10. (TEL-17) Étant donné une alerte déjà notifiée, quand une nouvelle source s'ajoute à son événement, alors aucun message ne part.
11. (TEL-24, TEL-26) Étant donné la catégorie « résultats suivis » désactivée, quand un match suivi est mesuré, alors aucun message ne part et le résultat est visible dans l'application.
12. (TEL-29) Étant donné un code de liaison produit depuis plus de 15 minutes, quand l'utilisateur touche « Démarrer » avec ce code, alors la liaison est refusée et l'écran propose un nouveau code.
13. (TEL-31) Étant donné une conversation non reliée, quand elle écrit au robot, alors elle ne reçoit aucune information et la tentative figure au journal d'activité.
14. (TEL-35, TEL-36, TEL-17) Étant donné Telegram injoignable de 2 h à 5 h, quand l'envoi redevient possible, alors un seul message de rattrapage récapitule les faits non reçus encore d'actualité, et aucun message déjà reçu n'est renvoyé.
15. (TEL-37) Étant donné que l'utilisateur a bloqué le robot, quand l'application tente un envoi, alors la liaison passe à « rompue » et l'accueil de l'application le signale.
16. (TEL-15) Étant donné une source de presse en panne déjà notifiée, quand la collecte suivante échoue encore, alors aucun nouveau message ne part ; un message court part quand la source fonctionne de nouveau.
17. (TEL-22) Étant donné le plafond de 20 messages atteint dans la journée, quand un 21e message devrait partir, alors un unique message « plafond atteint » part, puis plus rien jusqu'au lendemain.
18. (TEL-14) Étant donné une proposition de type en attente, quand la détection lui ajoute une occurrence, alors aucun message ne part.
19. (TEL-15) Étant donné toutes les sources actives en échec au cours d'une même collecte, quand l'incident « collecte impossible » est ouvert, alors un seul message part ; étant donné une source devenue muette, alors un message part comme pour un incident.
20. (TEL-29, TEL-01) Étant donné un code de liaison transmis depuis une conversation de groupe, quand le robot le reçoit, alors la liaison est refusée et aucun message n'est jamais envoyé à ce groupe.
21. (TEL-13) Étant donné un cas suivi enregistré après le coup d'envoi, quand son résultat est notifié, alors le message porte la mention « enregistré après le coup d'envoi, ne compte pas comme test ».

## Dépendances

- [02 — Taxonomie des événements](02-taxonomie-des-evenements.md) : types proposés et écran de validation.
- [03 — Collecte des actualités](03-collecte-des-actualites.md) : début et fin d'une panne de source, collecte impossible, source muette (COL-40 à COL-44).
- [04 — Détection des événements](04-detection-des-evenements.md) : décision d'alerte ou de demande, propositions de type, quota de classification, événements écartés.
- [05 — Demande de backtest et prompt](05-demande-de-backtest-et-prompt.md) : naissance de la demande, origine (détection, manuelle, complémentaire), échéance et sa mise à jour.
- [07 — Statistiques de match](07-statistiques-de-match.md) : coup d'envoi, calendrier, indisponibilité de la source et quota.
- [09 — Fiche d'alerte](09-fiche-d-alerte.md) : production, mises à jour et contenu de la fiche, dont le match attendu (ALE-15) et la mention « type non couvert par le backtest » (ALE-14).
- [10 — Suivi automatique et validation](10-suivi-automatique-et-validation.md) : résultat d'un cas suivi (SUI-19, SUI-20) et sa catégorie (SUI-22).
- [12 — Interface et accès](12-interface-et-acces.md) : écrans visés, réglages, fuseau horaire (IHM-14), authentification.
- [13 — Données sensibles](13-donnees-sensibles.md) : contenu minimal, conversation privée seule (DSN-31), retrait d'un événement et ses limites (DSN-28).
- [14 — Exigences transverses](14-exigences-transverses.md) : création du robot à l'installation, robot fermé aux inconnus (TRV-67), tâches planifiées et tâche non exécutée (TRV-31), quotas, sauvegarde et rappel d'export (TRV-50, TRV-54), blocage de la connexion (TRV-61), journal, paramètres.
- [90 — Journal des décisions](90-journal-des-decisions.md).

## Hypothèses et questions ouvertes

Renvois au journal :

- **D-30** : Telegram est le seul fournisseur nommé ; tous les autres services sont désignés par leur fonction (Q-02).
- **H-12** : tout ce document relève du lot 2 ; au lot 1, les mêmes faits ne sont visibles que dans l'application (document 12).
- **Q-01** : la mise en relation est décrite pour un utilisateur dont le niveau technique est inconnu ; la création du robot est décrite pas à pas dans le document 14.

Hypothèses locales :

- **H-TEL-01 — Sens unique** (à confirmer) : aucune action depuis Telegram ; tout passe par le lien vers l'application.
- **H-TEL-02 — Canal unique** (à confirmer) : ni notification propre de l'application installée, ni courriel, ni SMS.
- **H-TEL-03 — Valeurs par défaut** (à confirmer, toutes paramétrables) : plage de silence de 23 h à 8 h dans le fuseau de l'utilisateur ; exception d'urgence activée ; toutes les catégories activées, alertes non concluantes et fins d'incident comprises ; rappel activé, 6 h avant le coup d'envoi ; alertes envoyées une par une jusqu'à 3 par passage ; 10 faits détaillés au plus par message groupé ; plafond de 20 messages par jour ; nouvelles tentatives après 1, 5, 15, 30 et 60 minutes ; rappel d'incident tous les 3 jours ; pas de nouvelle notification d'un incident qui reprend dans les 6 h ; code de liaison valable 15 minutes.
- **H-TEL-04 — Suppression après retrait** (à confirmer) : en cas de retrait d'un événement (document 13), l'application tente de supprimer les messages qui le mentionnent, dans la limite de ce que Telegram permet.
- **H-TEL-05 — Pas de description dans les messages** (à confirmer) : un message désigne l'événement par son type et sa source, jamais par sa description, qui se lit dans l'application.
- **H-TEL-06 — Incident de sécurité** (à confirmer) : le blocage de la connexion après des échecs répétés (TRV-61) rejoint la catégorie des incidents.
- **H-TEL-07 — Source muette et rappel d'export** (à confirmer) : l'avertissement « source muette » est notifié comme un incident ; le rappel d'export donne un seul message par rappel, dans la catégorie des incidents.

Questions locales :

- **Q-TEL-01 — Types touchant à l'intime** : requalifiée en renvoi. Le document 13 y répond (DSN-35, H-DSN-12) : un message ne nomme jamais un type marqué « sujet intime » et désigne l'événement comme « événement sensible » ; TEL-06 l'applique.
