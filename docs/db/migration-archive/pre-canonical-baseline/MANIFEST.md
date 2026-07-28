# Pre-canonical migration archive

These 31 SQL files are the repository migration chain that existed at
`c838b490`. They are preserved here for review and source-level regression
tests, but files in this directory are **not** applied by Supabase CLI.

The chain could not build an empty local database because its first migration,
`20260723072626_add_user_alert_tickers.sql`, assumes that
`public.user_profiles`, `public.watchlist_tickers`, `public.tickers`, and
`public.set_user_alert_updated_at()` already exist. The hosted development
database records all 31 versions, which shows that its older prerequisite
schema was created outside this repository's migration history.

Because Stock Radar is still pre-release and the hosted rows are disposable
test data, the active migration directory was replaced with one reviewed,
schema-only baseline of the current hosted development schema. The baseline
was generated with Supabase CLI 2.110.0 using:

```text
supabase db dump --db-url <SUPABASE_DB_URL> --schema public,private
```

The dump contained no table data, auth users, or secrets. The review-only
`docs/db/schema_v1_draft.sql` was not used. The raw CLI dump had SHA-256
`f3acd969f2b18030a59e5af48eb28a8ad5363ba28f3f65a6e1615f9a2c727523`;
the active baseline adds only reviewed application extension declarations and
the database-scoped RLS event trigger that schema-filtered `pg_dump` omits,
plus one explicit privilege revoke needed to neutralize a local default grant.
The final reviewed baseline has SHA-256
`91846a7b004bac29790a8d25add7b12b5709f4c05c803806a9f268ff9b39b902`.

Do not move these files back into `supabase/migrations` or apply them after the
canonical baseline: they describe changes already represented by the snapshot
and would duplicate objects.

| Archived migration | SHA-256 | Bytes |
| --- | --- | ---: |
| `20260723072626_add_user_alert_tickers.sql` | `ec768cbe67fc7805e19b1525b7d95ef70546d96803a8dba86b92f52145f6a2c9` | 1690 |
| `20260723143430_add_dashboard_mover_snapshots.sql` | `5326a3a8c365297088d3e53fb4d873cebf8eb1838461a9d6cd762f7313f94d51` | 776 |
| `20260723152356_add_dashboard_extended_mover_snapshots.sql` | `d32b4fd107a5669c3a11f7918ddf2584990b70fb99af062bf58c145a90ef55c4` | 1076 |
| `20260723162509_add_dashboard_mover_finalization.sql` | `6f82363b6fb7e25812bcc227c44a4e2e59e38398a57d6b53fa12d122a76d9afe` | 944 |
| `20260724045009_add_company_logo_cache.sql` | `3bd937b587e1588687216b64c0baf211d78cafb224a27e453b09fabda7c7d187` | 961 |
| `20260724163831_filings_v2_server_pagination.sql` | `e284f764c9eb1d593e2f5e6ac4d0e16074209439b2c945f0000434f420545ed1` | 13808 |
| `20260724171114_lock_down_public_data_api.sql` | `7d2a5793b70d9eb4399c8265227b0aa66aa14969732d1fa026072b915ee71d5d` | 3397 |
| `20260724173656_news_v2_server_pagination.sql` | `b92fb2899e056d3b45a7bc0616819c8408bd74bb126a0c555613679bdda7a43c` | 11280 |
| `20260724175356_news_v2_theme_activity.sql` | `f1489c99606024dae13867bb9fdc0cc3dd471343446b657b407fde41e671e53c` | 6974 |
| `20260725015421_news_v2_filtered_stats_and_search_indexes.sql` | `728e42706fd685e3d6e8f63e32b80032d06dec4f2fe548bb1705ce2c41db0b58` | 18423 |
| `20260725015435_ingest_workflow_locks.sql` | `9f2bed418e1f4075f059d6c629e8f85a365b6ae0c0b454b51971465f5f38b194` | 3389 |
| `20260725215634_news_v2_market_score_threshold.sql` | `5ff7ff2afbeceaa6d38a421259698fc6c107a5aecddf7e9d724c2b2da5401496` | 2795 |
| `20260727101129_live_room_realtime_foundation.sql` | `52f0eab0dbfd5a0c6256ed8ee16303f26ee543c4f61c1a6c86a59c843f73756c` | 14498 |
| `20260727102419_live_room_foundation_hardening.sql` | `8a73d9e14d7e1dbaf81e7a7dd02728777245bba125b79409009870bba230f0fe` | 2003 |
| `20260727115223_live_room_realtime_moderation.sql` | `8dcad81a6a11a61ae1feaebe15a9b21dbf9e866b532a7a3c13d1154260bce925` | 16847 |
| `20260727121025_fix_live_room_block_moderation.sql` | `027011dbd9099cb43f2f9efdae2716789f73ff853c128167bc21ff9c945da79a` | 5379 |
| `20260727151010_live_room_chat_follows_and_member_follows.sql` | `5b4eede5ba532fc46e8c38566b9f0c942f8aee47359aa2abd3e2bf2e2a64fb74` | 8096 |
| `20260727152803_live_room_member_activity.sql` | `5958f339832eed0ff0e22b06558950ba477cf2d046f037941a1e9e45c5931042` | 14622 |
| `20260727174043_live_room_mutual_direct_messages.sql` | `097dee5732a708920611027bc4dbe5dbb8d3641d6fc93f3d694c10b24d8439ac` | 26135 |
| `20260727181214_live_room_member_presence.sql` | `467422c1d1c38a6b43d698e018156b98e725cc4f6d7456e8e5e1f41c5b04f4aa` | 8289 |
| `20260727185802_live_room_social_account_verification.sql` | `38eaf893cc7184b327142ff9416f684209a56329c32b3f74a7ed3e76d57327ac` | 18838 |
| `20260727190551_add_social_verification_reviewer_index.sql` | `46f985afe594fad4e25dcf4ba2582d2c3153ef620b1c5341ed2a714180860736` | 141 |
| `20260727202901_live_room_message_requests.sql` | `50b07e033aa078c90cbb134ee73112b214e8d1c670d5312cfdbd6a01903f9b3d` | 57283 |
| `20260727204014_add_direct_message_report_fk_index.sql` | `4879e1222b1d0d0a7edd67a1ce6489332de662d9eb4477cd37dd3fd11fac0f9a` | 185 |
| `20260727215804_live_room_community_rooms.sql` | `77a67b9278aef474097259c49b6177f0da5a838e5adb3d0d918e13673548ed6b` | 35370 |
| `20260728034730_community_room_discovery_anchors.sql` | `b637326cb967a9a7d0357631b987c70cb5a2b12a4d1285baff715aa528e0e5c0` | 19819 |
| `20260728040409_live_room_posts.sql` | `114245f8f8a614fe89f0c6ab09cf8e15ce0499ec6fcb366b61412be24c518b15` | 21072 |
| `20260728055733_live_room_post_cross_posts.sql` | `f19c6b1ad66da78928459ccc5bf1bdd1f4eff5b0835e7cf725f0e5c4f1701288` | 2176 |
| `20260728074123_fix_live_room_pg17_coalesce.sql` | `1fbfc2ea1d0efcd68caa929320ffb7e763d513eddbf03dc2ec910a9d4a52546e` | 1280 |
| `20260728082957_live_room_post_comments.sql` | `e47967f465bcd5dc916ff9e512425f0fea1222808a8a24b06c0aadd774b2cfe1` | 11566 |
| `20260728094224_live_room_post_activity.sql` | `06be0252da477234e699229a6553ee2851d95b544a5e9f7a64b309cffda89a6a` | 12090 |
