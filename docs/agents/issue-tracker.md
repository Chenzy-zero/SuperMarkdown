# Issue tracker: GitHub

任务与规格记录在 Chenzy-zero/SuperMarkdown 的 GitHub Issues，使用 gh CLI 操作。

## 仓库定位

从 git remote -v 确认仓库。创建本次会话的第一个 Issue 前，运行 gh repo view --json nameWithOwner，核对目标为 Chenzy-zero/SuperMarkdown；若不一致，先解决目标差异。

## 常用操作

- 创建：gh issue create --repo Chenzy-zero/SuperMarkdown --title "..." --body-file <文件>。多行正文先写入 UTF-8 文件。
- 读取：gh issue view <编号> --json number,title,body,labels,comments。
- 列表：gh issue list --state open --json number,title,body,labels，按需要加 --label 或 --state 筛选。
- 评论：gh issue comment <编号> --body-file <文件>。
- 标签：gh issue edit <编号> --add-label "..." 或 --remove-label "..."。
- 关闭：先发表评论解释结果，再运行 gh issue close <编号>。

## 父子任务与阻塞

优先使用 GitHub 原生子任务及 Issue dependencies。使用当前 gh 版本帮助确认支持的参数；需要时使用 gh api。

- 父子关联：POST repos/Chenzy-zero/SuperMarkdown/issues/<父编号>/sub_issues，传入 sub_issue_id=<子任务数据库 id>。
- 添加阻塞：POST repos/Chenzy-zero/SuperMarkdown/issues/<被阻塞编号>/dependencies/blocked_by，传入 issue_id=<阻塞任务数据库 id>。
- 数据库 id：gh api repos/Chenzy-zero/SuperMarkdown/issues/<编号> --jq .id，区别于 Issue 编号和 node_id。
- 查询未关闭的阻塞数量：gh api repos/Chenzy-zero/SuperMarkdown/issues/<编号> --jq .issue_dependencies_summary.blocked_by。
- 原生关联不可用时，在子任务正文开头写 Part of #<父编号>、Blocked by: #<编号>，并在父任务维护子任务清单。所有阻塞任务关闭后才可开始。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## 技能约定

- “publish to the issue tracker”：创建 GitHub Issue。
- “fetch the relevant ticket”：读取对应 Issue 及评论。
- wayfinder 的地图为带 wayfinder:map 标签的 Issue；子任务关联地图，使用 wayfinder:research、wayfinder:prototype、wayfinder:grilling 或 wayfinder:task 标签。
- wayfinder 按地图顺序选择无未关闭阻塞且无人认领的子任务，使用 gh issue edit <编号> --add-assignee @me 认领；完成后评论、关闭，并将结论链接补入地图。
