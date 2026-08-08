# Stock Radar 운영 코드 일치 규칙

## Mandatory worktree acceptance and merge gate

- A worktree completion report, code review, or passing tests alone never authorizes a merge. The main integration agent must independently verify the original user request before merging.
- Before delegation, write concrete acceptance checks from the user's request: affected screens or APIs, expected behavior, relevant account or plan states, and required viewport sizes.
- Before merging, compare every changed file and behavior in the candidate branch to those acceptance checks. Any unrequested change blocks the merge until it is removed, split into a separate task, or explicitly approved by the user.
- For every UI, route, authentication, permission, redirect, data, or plan change, verify the actual user journey on the task branch before merge. Test the exact direct URLs the user uses, logged-out and relevant logged-in states, and PC, intermediate, and 390px mobile views when affected.
- For visual work, inspect the rendered screen and DOM layout where needed. Source code and automated tests are supporting evidence only, never completion evidence.
- Mark checks that could not be performed as unverified. Unverified or ambiguous behavior blocks merging and must return to the task branch rather than being assumed correct.
- After merging, repeat the critical user-journey checks on local `main`. If the merged result differs from the task result, stop further integration and report the discrepancy before making more changes.

이 문서는 Stock Radar의 로컬 코드, GitHub 코드, Vercel 운영 코드가 서로 달라지는 사고를 막기 위한 필수 운영 규칙이다. 모든 메인 통합 작업, push, 배포, 롤백, 새 작업방 인계에서 반드시 확인한다.

## 1. 가장 중요한 원칙

- 운영 코드의 기준은 GitHub `main`의 정확한 커밋 번호다.
- 로컬 `main`과 GitHub `main`의 커밋 번호가 같으면 Git에 등록된 파일은 동일하다.
- Vercel 운영 배포도 같은 커밋 번호여야 코드까지 동일하다.
- 기능 브랜치와 개발 중인 파일은 운영 코드와 달라도 정상이다. 운영 배포 시점에는 로컬 `main`, GitHub `main`, Vercel 배포 커밋이 같아야 한다.
- 같은 커밋 번호라고 해도 환경변수, 데이터베이스, 캐시, 외부 서비스 설정은 별도 상태이므로 따로 확인한다.

## 2. 용어

- 로컬 `main`: 메인 통합 폴더에 있는 최종 코드
- GitHub `main`: 원격 저장소에 올라간 최종 코드
- Vercel 배포 커밋: 현재 운영 도메인이 실제로 실행 중인 코드의 커밋 번호
- 기능 브랜치: 별도 작업방에서 아직 운영에 반영하지 않은 작업
- 커밋 번호: 해당 코드 상태를 식별하는 고유 번호

## 3. 기능 작업 규칙

1. 기능은 별도 작업방, 별도 브랜치, 별도 worktree에서 구현한다.
2. 작업방은 시작 기준 `main` 커밋을 기록한다.
3. 작업방의 모든 필요한 파일을 커밋하고 작업 상태를 clean으로 만든다.
4. 완료 보고에는 최종 커밋, 변경 파일, 테스트, 실제 화면 확인, clean 상태를 적는다.
5. 비밀값, `.env.local`, 장비별 LAN 주소, 임시 데이터, 대용량 원본 자료를 커밋하지 않는다.
6. 작업 중 시행착오는 정리하고, 메인에 필요한 완성된 변경만 남긴다.

## 4. 메인 병합 전 검사

메인방은 작업방의 완료 보고만 믿지 않고 실제 변경 전후를 확인한다.

1. 작업 브랜치의 최종 커밋과 clean 상태를 확인한다.
2. 작업 시작 전과 완료 후 사이에 추가, 수정, 삭제된 모든 파일을 확인한다.
3. 보고된 작업 범위와 실제 변경 파일이 일치하는지 확인한다.
4. 관계없는 파일, 자동 변경 파일, 비밀값, 테스트용 대용량 파일이 섞이지 않았는지 확인한다.
5. 작업방에서 빠진 커밋이나 커밋되지 않은 파일이 없는지 확인한다.
6. 전체 기능 브랜치를 `git merge --no-ff`로 병합한다. 일부 커밋만 가져오는 경우는 사용자가 명시적으로 요청한 때만 허용한다.
7. 충돌이 발생하면 양쪽 코드의 의미를 확인해 해결한다. 한쪽을 기계적으로 선택하지 않는다.

## 5. 메인 병합 후 검사

1. 병합 직전 `main`과 병합 완료 `main` 사이의 모든 변경 파일을 다시 확인한다.
2. 작업 브랜치의 완성된 변경이 병합 결과에 모두 포함됐는지 비교한다.
3. 충돌 해결 과정에서 빠진 코드나 중복 코드가 없는지 확인한다.
4. 관련 자동 테스트, 타입 검사, 필요한 전체 테스트를 실행한다.
5. 코드 테스트만으로 끝내지 않고 PC, 중간 폭, 390px 모바일 실제 화면과 핵심 동작을 확인한다.
6. 콘솔 오류, 실패한 요청, 가로 넘침, 인증·플랜 상태를 확인한다.
7. 최종 병합 커밋과 포함된 파일 목록을 기록한다.
8. 이 검사가 하나라도 끝나지 않으면 push하지 않는다.

## 6. Push 전 검사

1. 사용자가 이번 push를 명시적으로 승인했는지 확인한다.
2. 현재 폴더가 지정된 메인 통합 폴더이고 브랜치가 `main`인지 확인한다.
3. 의도하지 않은 미커밋 파일과 새 파일이 없는지 확인한다.
4. 로컬 전용 설정은 push 대상에서 제외됐는지 확인한다.
5. 원격 상태를 갱신하고 원격에만 있는 새 커밋이 없는지 확인한다.
6. 로컬 `main`의 최종 커밋 번호를 기록한다.
7. 새로 올라갈 변경에 50MB 이상의 파일, 원본 공시 묶음, 불필요한 테스트 자료가 없는지 검사한다.
8. 비밀키, 토큰, 쿠키, 사용자 비밀정보가 포함되지 않았는지 검사한다.
9. 모든 검사 결과를 사용자에게 짧게 보고한 뒤 push한다.

## 7. Push 후 일치 확인

Push 성공 메시지만으로 완료 처리하지 않는다.

1. 로컬 `main` 커밋 번호를 확인한다.
2. GitHub `main` 커밋 번호를 확인한다.
3. 두 번호가 정확히 같은지 확인한다.
4. 로컬과 원격 사이에 앞서거나 뒤처진 커밋이 0개인지 확인한다.
5. GitHub에 올라간 최종 파일 목록이 병합 결과와 같은지 확인한다.
6. 이 확인이 끝나야 GitHub 코드 일치를 완료로 보고한다.

## 8. Vercel 배포 확인

GitHub push와 Vercel 배포는 별개의 완료 조건이다.

1. GitHub `main`의 새 커밋으로 Vercel 배포가 실제 생성됐는지 확인한다.
2. Vercel 배포 상태가 `READY`인지 확인한다.
3. Vercel 배포 커밋 번호가 GitHub `main`과 같은지 확인한다.
4. 운영 도메인이 그 새 배포를 가리키는지 확인한다.
5. 운영 PC와 390px 모바일에서 핵심 페이지를 직접 확인한다.
6. 콘솔 오류와 실패 요청을 확인한다.
7. 새 배포가 생성되지 않았거나 예전 커밋이면 배포 완료로 보고하지 않는다.

운영 배포 완료 조건은 다음 세 번호가 모두 같은 것이다.

```text
로컬 main 커밋 번호
GitHub main 커밋 번호
Vercel 운영 배포 커밋 번호
```

## 9. 코드 외 운영 상태

다음 항목은 Git 코드가 같아도 달라질 수 있으므로 별도로 기록하고 확인한다.

- Vercel 환경변수
- 로컬 및 원격 Supabase migration 상태
- 운영 데이터와 테스트 데이터
- RLS와 데이터베이스 권한
- Resend, Telegram, SnapTrade 및 외부 서비스 설정
- Cron 활성화 상태
- CDN과 애플리케이션 캐시
- 도메인과 접근 게이트 설정

운영 배포 보고에는 적용된 migration, 변경된 환경변수 이름, cron 상태, 외부 서비스 연결 상태를 실제 비밀값 없이 기록한다.

## 10. 로컬 전용 파일

- `.env.local`은 절대 커밋하거나 출력하지 않는다.
- 휴대폰 LAN 테스트를 위한 개인 IP 주소는 원격에 올리지 않는다.
- `supabase/config.toml`이 장비별 LAN 주소로 변경된 경우 로컬 전용 변경으로 명시하고 push 대상에서 제외한다.
- `node_modules`, 빌드 결과, 임시 로그, 브라우저 캡처, 개인 테스트 파일은 원격 코드에 포함하지 않는다.

## 11. 대용량 파일과 비밀정보

- 50MB 이상의 파일은 push 전에 작업을 멈추고 필요성을 검토한다.
- 실제 공시 원본, 이미지 묶음, 대형 테스트 자료는 작은 샘플, Git LFS 또는 외부 저장소를 사용한다.
- 대용량 파일이 테스트에 필요하면 운영 코드와 분리하고 최소 샘플로 같은 결과를 검증한다.
- 비밀정보가 커밋되면 삭제 커밋만 추가하지 않는다. 즉시 키를 폐기하고 기록에서도 제거한다.
- 이미 원격에 올라간 대용량 파일이나 비밀정보를 발견하면 추가 push와 배포를 멈추고 기록 정리 계획을 먼저 승인받는다.

## 12. 운영 중 변경과 롤백

1. 운영 수정도 별도 브랜치에서 구현하고 검증한다.
2. 검증된 변경만 `main`에 병합한다.
3. push 후 GitHub와 Vercel의 커밋 번호를 확인한다.
4. 장애가 발생하면 임의로 서버 파일을 직접 고치지 않는다.
5. 직전 정상 커밋으로 Vercel을 롤백하거나 수정 커밋을 만들어 다시 배포한다.
6. 롤백한 커밋 번호와 원인을 기록한다.
7. 원격 `main` 직접 편집과 승인되지 않은 강제 push를 금지한다.

## 13. 새 작업방 인계 필수 항목

Stock Radar 작업방을 새로 만들거나 후속 작업방으로 옮길 때 다음 내용을 반드시 전달한다.

- 프로젝트 절대 경로
- 메인 통합 폴더와 `main` 고정 규칙
- 최신 로컬 `main` 커밋 번호
- GitHub `main` 커밋 번호와 로컬과의 일치 여부
- Vercel 운영 배포 커밋 번호와 배포 상태
- 현재 미커밋 파일과 그 이유
- 진행 중인 기능 브랜치와 작업방
- 아직 병합하지 않은 완료 커밋
- 마지막으로 통과한 테스트와 실제 화면 검증
- 로컬 및 원격 Supabase migration 상태
- 변경된 환경변수 이름과 외부 서비스 상태. 실제 값은 전달하지 않는다.
- Cron 활성화 상태
- push 및 배포 승인 여부
- 현재 차단 문제와 다음 작업 순서

인계받은 작업방은 이 정보를 그대로 믿지 않고 시작 시 실제 상태를 다시 확인한다.

## 14. 완료 보고 형식

운영 관련 완료 보고에는 최소한 다음을 포함한다.

```text
로컬 main: <커밋 번호>
GitHub main: <커밋 번호>
Vercel 배포: <커밋 번호와 상태>
코드 일치: 예/아니오
미커밋 파일: <목록과 이유>
테스트: <결과>
DB migration: <상태>
환경변수/외부 서비스: <값을 제외한 상태>
PC·모바일 확인: <결과>
```

세 커밋 번호가 다르거나 확인하지 못한 항목이 있으면 완료라고 표현하지 않는다.
