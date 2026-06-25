using System.Collections.ObjectModel;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using BxbHomework.WinUI.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Streams;

namespace BxbHomework.WinUI;

public sealed class DisplayItem
{
    public string Id { get; init; } = "";
    public string Title { get; init; } = "";
    public string Subtitle { get; init; } = "";
    public string Path { get; init; } = "";
    public JsonElement Data { get; init; }
}

public sealed class ComboItem
{
    public string Key { get; init; } = "";
    public string Label { get; init; } = "";
    public JsonElement Data { get; init; }
    public override string ToString() => Label;
}

public sealed class PrivateThreadMessage
{
    public string Sender { get; init; } = "";
    public string Time { get; init; } = "";
    public string Content { get; init; } = "";
    public HorizontalAlignment Alignment { get; init; } = HorizontalAlignment.Left;
}

internal sealed record AgentChatMessage(string Role, string Text);

public sealed partial class MainWindow : Window
{
    private static readonly JsonSerializerOptions PrettyJsonOptions = new() { WriteIndented = true };
    private readonly NodeBackendClient _backend = new();
    private readonly ObservableCollection<DisplayItem> _items = new();
    private readonly ObservableCollection<DisplayItem> _settingsPathItems = new();
    private readonly ObservableCollection<PrivateThreadMessage> _privateThreadMessages = new();
    private string _currentPage = "home";
    private JsonElement? _session;
    private JsonElement? _appInfo;
    private JsonElement? _selectedDraft;
    private JsonElement? _draftSubmitPreview;
    private JsonElement? _draftMessagePreview;
    private readonly List<AgentChatMessage> _agentPreviewMessages = new();
    private WebView2? _agentMarkdownWebView;
    private bool _agentMarkdownWebViewUnavailable;
    private int _agentMarkdownRenderVersion;
    private bool _suppressComboEvents;
    private bool _deleteDraftArmed;
    private bool _deleteConversationArmed;
    private bool _draftCreateMode;
    private int _pageLoadVersion;
    private bool _settingsHasApiKey;
    private string _settingsDefaultSystemPrompt = "";
    private bool _suppressSettingsModelCombo;

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        MainListView.ItemsSource = _items;
        SettingsPathListView.ItemsSource = _settingsPathItems;
        PrivateThreadListView.ItemsSource = _privateThreadMessages;

        _backend.LogReceived += (_, message) => DispatcherQueue.TryEnqueue(() => SetStatus(message));

        RootNavigation.SelectedItem = RootNavigation.MenuItems[0];
        RenderHome();
        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        try
        {
            BackendStateText.Text = "正在连接后端...";
            await _backend.EnsureStartedAsync();
            _appInfo = await InvokeAsync("app:info");
            BackendStateText.Text = $"Node {_appInfo.Value.GetProperty("nodeVersion").GetString()}";
            await RefreshSessionAsync();
            SetStatus("Ready");
        }
        catch (Exception error)
        {
            BackendStateText.Text = "后端连接失败";
            SetDetail(error.Message);
            SetStatus(error.Message);
        }
    }

    private void OnNavigationSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        var tag = args.IsSettingsSelected
            ? "settings"
            : (args.SelectedItem as NavigationViewItem)?.Tag?.ToString();
        _ = OpenPageAsync(tag ?? "home");
    }

    private async Task OpenPageAsync(string page)
    {
        var loadVersion = ++_pageLoadVersion;
        try
        {
            switch (page)
            {
                case "agent":
                    RenderAgent();
                    await LoadConversationsAsync(loadVersion);
                    break;
                case "homework":
                    RenderHomework();
                    await LoadHomeworkCoursesAsync(loadVersion);
                    break;
                case "workspace":
                    RenderWorkspace();
                    await LoadWorkspaceFilesAsync(loadVersion);
                    break;
                case "messages":
                    RenderMessages();
                    await LoadPrivateContactsAsync(loadVersion);
                    break;
                case "drafts":
                    RenderDrafts();
                    await LoadDraftsAsync("pending_review", loadVersion);
                    break;
                case "settings":
                    RenderSettings();
                    await LoadSettingsAsync(loadVersion);
                    break;
                default:
                    RenderHome();
                    await RefreshSessionAsync();
                    break;
            }
        }
        catch (Exception error)
        {
            if (loadVersion == _pageLoadVersion)
            {
                SetPageError(error.Message);
            }
        }
    }

    private bool IsCurrentPageLoad(string page, int loadVersion)
    {
        return _currentPage == page && loadVersion == _pageLoadVersion;
    }

    private void ResetPage()
    {
        _currentPage = "";
        _items.Clear();
        _privateThreadMessages.Clear();
        MainListView.SelectedItem = null;
        DetailTitleText.Text = "详情";
        DetailTextBox.Text = "";
        DetailTextBox.Visibility = Visibility.Visible;
        EditorTextBox.Text = "";
        EditorTextBox.Visibility = Visibility.Collapsed;
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        PrivateMessageComposerPanel.Visibility = Visibility.Collapsed;
        PrivateMessageInputBox.Text = "";
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        WorkspaceImagePreview.Source = null;
        DetailImageCaption.Text = "";
        CommandInputBox.Text = "";
        CommandInputBox.Visibility = Visibility.Collapsed;
        ToolbarCard.Visibility = Visibility.Visible;
        HomePanel.Visibility = Visibility.Collapsed;
        AgentPanel.Visibility = Visibility.Collapsed;
        SplitPanel.Visibility = Visibility.Collapsed;
        SettingsPanel.Visibility = Visibility.Collapsed;
        PrimaryComboBox.Visibility = Visibility.Collapsed;
        FilterComboBox.Visibility = Visibility.Collapsed;
        SecondaryActionButton.Visibility = Visibility.Collapsed;
        ThirdActionButton.Visibility = Visibility.Collapsed;
        FourthActionButton.Visibility = Visibility.Collapsed;
        DangerActionButton.Visibility = Visibility.Collapsed;
        DetailPrimaryButton.Visibility = Visibility.Collapsed;
        DetailSecondaryButton.Visibility = Visibility.Collapsed;
        SetAgentTranscriptPlain("");
        AgentStepsTextBox.Text = "";
        AgentInputBox.Text = "";
        ConversationComboBox.Items.Clear();
        SettingsMainTextBox.Text = "";
        SettingsModelStatusText.Text = "";
        SettingsUpdateNotesText.Text = "";
        _settingsPathItems.Clear();
        SettingsOpenPathButton.Visibility = Visibility.Collapsed;
        _selectedDraft = null;
        _draftSubmitPreview = null;
        _draftMessagePreview = null;
        _deleteDraftArmed = false;
        _deleteConversationArmed = false;
        _draftCreateMode = false;
    }

    private void RenderHome()
    {
        ResetPage();
        _currentPage = "home";
        PageTitleText.Text = "Banxuebang Homework";
        PageSubtitleText.Text = "登录状态、当前学期和应用数据路径。";
        HomePanel.Visibility = Visibility.Visible;
        ListTitleText.Text = "会话";
        PrimaryActionButton.Content = "浏览器登录";
        SecondaryActionButton.Content = "刷新会话";
        SecondaryActionButton.Visibility = Visibility.Visible;
        ThirdActionButton.Content = "打开数据目录";
        ThirdActionButton.Visibility = Visibility.Visible;
        SetHomeSessionBlocks(_session);
    }

    private void RenderAgent()
    {
        ResetPage();
        _currentPage = "agent";
        PageTitleText.Text = "Agent Assistant";
        PageSubtitleText.Text = "对话列表、聊天输入和上下文压缩沿用 Electron 的 agent 流程。";
        ToolbarCard.Visibility = Visibility.Collapsed;
        AgentPanel.Visibility = Visibility.Visible;
        AgentStepsTextBox.Text = "等待执行。";
    }

    private void RenderHomework()
    {
        ResetPage();
        _currentPage = "homework";
        PageTitleText.Text = "作业中心";
        PageSubtitleText.Text = "和 Electron 一样：先选择课程，再加载作业，点作业读取详情。";
        SplitPanel.Visibility = Visibility.Visible;
        SplitLeftColumn.Width = new GridLength(1.45, GridUnitType.Star);
        ListTitleText.Text = "作业";
        PrimaryComboBox.Visibility = Visibility.Visible;
        FilterComboBox.Visibility = Visibility.Visible;
        SetFilterItems(("all", "全部作业"), ("pending", "待处理作业"));
        PrimaryActionButton.Content = "刷新作业";
        SecondaryActionButton.Content = "刷新课程";
        SecondaryActionButton.Visibility = Visibility.Visible;
    }

    private void RenderWorkspace()
    {
        ResetPage();
        _currentPage = "workspace";
        PageTitleText.Text = "工作区";
        PageSubtitleText.Text = "本地文件区：导入、助手下载和粘贴保存的文件。";
        SplitPanel.Visibility = Visibility.Visible;
        SplitLeftColumn.Width = new GridLength(0.9, GridUnitType.Star);
        ListTitleText.Text = "文件";
        CommandInputBox.Visibility = Visibility.Visible;
        CommandInputBox.PlaceholderText = "搜索文件名";
        PrimaryActionButton.Content = "刷新";
        SecondaryActionButton.Content = "打开文件夹";
        SecondaryActionButton.Visibility = Visibility.Visible;
    }

    private void RenderMessages()
    {
        ResetPage();
        _currentPage = "messages";
        PageTitleText.Text = "私信";
        PageSubtitleText.Text = "左侧联系人，右侧线程；输入文本后点击发送。";
        SplitPanel.Visibility = Visibility.Visible;
        SplitLeftColumn.Width = new GridLength(330);
        ListTitleText.Text = "联系人";
        CommandInputBox.Visibility = Visibility.Collapsed;
        PrimaryActionButton.Content = "刷新私信";
        PrivateMessageComposerPanel.Visibility = Visibility.Visible;
    }

    private void RenderDrafts()
    {
        ResetPage();
        _currentPage = "drafts";
        PageTitleText.Text = "草稿";
        PageSubtitleText.Text = "左侧草稿列表，右侧正文编辑；提交/私信前生成确认预览。";
        SplitPanel.Visibility = Visibility.Visible;
        SplitLeftColumn.Width = new GridLength(0.82, GridUnitType.Star);
        ListTitleText.Text = "草稿";
        FilterComboBox.Visibility = Visibility.Visible;
        SetFilterItems(
            ("pending_review", "待审核"),
            ("approved", "已通过"),
            ("rejected", "已驳回"),
            ("submitted", "已提交"),
            ("sent_to_teacher", "已私信老师"),
            ("all", "全部"));
        PrimaryActionButton.Content = "刷新草稿";
        SecondaryActionButton.Content = "保存正文";
        SecondaryActionButton.Visibility = Visibility.Visible;
        ThirdActionButton.Content = "通过审核";
        ThirdActionButton.Visibility = Visibility.Visible;
        FourthActionButton.Content = "创建草稿";
        FourthActionButton.Visibility = Visibility.Visible;
        DangerActionButton.Content = "删除草稿";
        DangerActionButton.Visibility = Visibility.Visible;
        DetailPrimaryButton.Content = "准备提交/私信";
        DetailPrimaryButton.Visibility = Visibility.Collapsed;
        DetailSecondaryButton.Content = "驳回";
        DetailSecondaryButton.Visibility = Visibility.Collapsed;
    }

    private void RenderSettings()
    {
        ResetPage();
        _currentPage = "settings";
        PageTitleText.Text = "设置";
        PageSubtitleText.Text = "模型配置、软件更新和路径信息按 Electron 设置页组织。";
        SettingsPanel.Visibility = Visibility.Visible;
        ListTitleText.Text = "设置项";
        CommandInputBox.Visibility = Visibility.Collapsed;
        PrimaryActionButton.Content = "读取模型";
        SecondaryActionButton.Content = "检查更新";
        SecondaryActionButton.Visibility = Visibility.Visible;
        ThirdActionButton.Content = "打开 Release";
        ThirdActionButton.Visibility = Visibility.Visible;
    }

    private void SetFilterItems(params (string Key, string Label)[] rows)
    {
        _suppressComboEvents = true;
        FilterComboBox.Items.Clear();
        foreach (var row in rows)
        {
            FilterComboBox.Items.Add(new ComboItem { Key = row.Key, Label = row.Label });
        }
        FilterComboBox.SelectedIndex = rows.Length > 0 ? 0 : -1;
        _suppressComboEvents = false;
    }

    private async Task<JsonElement> InvokeAsync(string method, object? parameters = null)
    {
        return await _backend.InvokeAsync(method, parameters);
    }

    private async Task<JsonElement> ToolAsync(string name, object? args = null)
    {
        SetStatus($"调用 {name}...");
        var result = await InvokeAsync("bxb:tool", new { name, args = args ?? new { } });
        SetStatus($"{name} 完成");
        return result;
    }

    private async Task RefreshSessionAsync()
    {
        _session = await InvokeAsync("bxb:session");
        BackendStateText.Text = _session.Value.TryGetProperty("ready", out var ready) && ready.GetBoolean()
            ? $"当前用户：{GetString(_session.Value, "user.name", "已登录")}"
            : "未登录";
        SetHomeSessionList();
        if (_currentPage == "home") SetHomeSessionBlocks(_session.Value);
    }

    private void SetHomeSessionList()
    {
        if (_currentPage != "home" || !_session.HasValue) return;
        _items.Clear();
        _items.Add(new DisplayItem
        {
            Id = "session",
            Title = GetString(_session.Value, "user.name", "未登录"),
            Subtitle = $"{GetString(_session.Value, "currentTermName", "未知学期")} · {GetString(_session.Value, "currentSubject.name", "未知课程")}",
            Data = _session.Value.Clone(),
        });
        if (_appInfo.HasValue)
        {
            _items.Add(new DisplayItem
            {
                Id = "app",
                Title = $"Windows stable v{GetString(_appInfo.Value, "version", "unknown")}",
                Subtitle = GetString(_appInfo.Value, "dataRoot", ""),
                Data = _appInfo.Value.Clone(),
            });
        }
        SetHomeSessionBlocks(_session.Value);
    }

    private void SetHomeSessionBlocks(JsonElement? session)
    {
        if (!session.HasValue)
        {
            HomeSessionStatusText.Text = "读取中";
            HomeUserText.Text = "-";
            HomeScopeText.Text = "-";
            HomePendingTaskText.Text = "-";
            HomeTermText.Text = "-";
            HomeSessionFileText.Text = "等待后端返回当前登录状态。";
            return;
        }

        var value = session.Value;
        var ready = GetString(value, "ready", "false") == "true" ? "已登录" : "未登录";
        var user = GetString(value, "user.name", "未知用户");
        var className = GetString(value, "currentClass.name", "未知班级");
        var subject = GetString(value, "currentSubject.name", "未知课程");
        var term = FirstString(value, "currentTermName", "currentTermId");
        var pending = GetString(value, "currentSubject.unSubmitCount", "0");
        var sessionFile = GetString(value, "sessionFile", "");

        HomeSessionStatusText.Text = ready;
        HomeUserText.Text = user;
        HomeScopeText.Text = $"{className} · {subject}";
        HomePendingTaskText.Text = pending;
        HomeTermText.Text = string.IsNullOrWhiteSpace(term) ? "未知学期" : term;
        HomeSessionFileText.Text = string.IsNullOrWhiteSpace(sessionFile) ? "-" : sessionFile;
    }

    private async Task LoadConversationsAsync(int loadVersion = 0)
    {
        loadVersion = loadVersion == 0 ? _pageLoadVersion : loadVersion;
        if (!IsCurrentPageLoad("agent", loadVersion)) return;
        SetAgentTranscriptPlain("正在加载对话...");
        AgentStepsTextBox.Text = "等待执行。";
        var result = await InvokeAsync("agent:conversations:list");
        if (!IsCurrentPageLoad("agent", loadVersion)) return;
        _items.Clear();
        _suppressComboEvents = true;
        ConversationComboBox.Items.Clear();
        if (result.TryGetProperty("conversations", out var conversations) && conversations.ValueKind == JsonValueKind.Array)
        {
            foreach (var conversation in conversations.EnumerateArray())
            {
                var item = new DisplayItem
                {
                    Id = GetString(conversation, "id", ""),
                    Title = GetString(conversation, "title", "新对话"),
                    Subtitle = $"{GetString(conversation, "updatedAt", "")} · {GetString(conversation, "messageCount", "0")} 条消息",
                    Data = conversation.Clone(),
                };
                _items.Add(item);
                ConversationComboBox.Items.Add(new ComboItem { Key = item.Id, Label = item.Title, Data = item.Data });
            }
        }
        var activeId = GetString(result, "activeId", "");
        for (var index = 0; index < ConversationComboBox.Items.Count; index += 1)
        {
            if ((ConversationComboBox.Items[index] as ComboItem)?.Key == activeId)
            {
                ConversationComboBox.SelectedIndex = index;
                break;
            }
        }
        if (ConversationComboBox.SelectedIndex < 0 && ConversationComboBox.Items.Count > 0)
        {
            ConversationComboBox.SelectedIndex = 0;
        }
        _suppressComboEvents = false;
        if (result.TryGetProperty("activeConversation", out var active))
        {
            ShowConversation(active);
        }
        else if (ConversationComboBox.Items.Count == 0)
        {
            SetAgentTranscriptPlain("暂无对话。点击“新建”开始。");
        }
    }

    private async Task LoadHomeworkCoursesAsync(int loadVersion = 0)
    {
        loadVersion = loadVersion == 0 ? _pageLoadVersion : loadVersion;
        if (!IsCurrentPageLoad("homework", loadVersion)) return;
        SetListState("正在加载课程", "从办学帮读取课程列表。");
        SetDetail("正在加载课程和作业...");
        var result = await ToolAsync("list_courses");
        if (!IsCurrentPageLoad("homework", loadVersion)) return;
        var rows = ReadArray(result, "courses", "items", "records");
        _suppressComboEvents = true;
        PrimaryComboBox.Items.Clear();
        PrimaryComboBox.Items.Add(new ComboItem { Key = "__all_courses__", Label = "全部课程" });
        foreach (var row in rows)
        {
            PrimaryComboBox.Items.Add(new ComboItem
            {
                Key = GetCourseKey(row),
                Label = GetString(row, "name", "未命名课程"),
                Data = row.Clone(),
            });
        }
        PrimaryComboBox.SelectedIndex = 0;
        _suppressComboEvents = false;
        await LoadTasksAsync(loadVersion);
    }

    private async Task LoadTasksAsync(int loadVersion = 0)
    {
        loadVersion = loadVersion == 0 ? _pageLoadVersion : loadVersion;
        if (!IsCurrentPageLoad("homework", loadVersion)) return;
        SetListState("正在加载作业", "正在按当前课程和筛选条件读取。");
        SetDetail("正在加载作业...");
        var course = PrimaryComboBox.SelectedItem as ComboItem;
        var listType = (FilterComboBox.SelectedItem as ComboItem)?.Key ?? "all";
        var args = new Dictionary<string, object?>
        {
            ["list_type"] = listType,
            ["page"] = 1,
            ["size"] = 100,
        };
        if (course is not null && course.Key != "__all_courses__")
        {
            args["subject_name"] = course.Label;
            var subjectId = GetString(course.Data, "id", "");
            var classId = GetString(course.Data, "classId", "");
            if (!string.IsNullOrWhiteSpace(subjectId)) args["subject_id"] = subjectId;
            if (!string.IsNullOrWhiteSpace(classId)) args["class_id"] = classId;
        }
        else
        {
            args["subject_name"] = "全部课程";
        }

        var result = await ToolAsync("list_tasks", args);
        if (!IsCurrentPageLoad("homework", loadVersion)) return;
        _items.Clear();
        foreach (var task in ExtractTaskRows(result))
        {
            _items.Add(new DisplayItem
            {
                Id = GetTaskId(task),
                Title = GetTaskTitle(task),
                Subtitle = $"{GetTaskCourse(task)} · {GetTaskDeadline(task)} · {GetTaskStatus(task)}",
                Data = task.Clone(),
            });
        }
        SetDetail(_items.Count == 0 ? "暂无作业数据。" : "选择左侧作业读取详情。");
        if (IsCurrentPageLoad("homework", loadVersion))
        {
            await RefreshSessionAsync();
        }
    }

    private async Task LoadWorkspaceFilesAsync(int loadVersion = 0)
    {
        loadVersion = loadVersion == 0 ? _pageLoadVersion : loadVersion;
        if (!IsCurrentPageLoad("workspace", loadVersion)) return;
        SetListState("正在加载文件", "读取本地工作区文件。");
        SetDetail("正在加载工作区文件...");
        var result = await ToolAsync("list_workspace_files", new { query = CommandInputBox.Text.Trim(), max_files = 300 });
        if (!IsCurrentPageLoad("workspace", loadVersion)) return;
        _items.Clear();
        if (result.TryGetProperty("files", out var files) && files.ValueKind == JsonValueKind.Array)
        {
            foreach (var file in files.EnumerateArray())
            {
                _items.Add(new DisplayItem
                {
                    Id = GetString(file, "relativePath", GetString(file, "name", "")),
                    Title = GetString(file, "name", "未命名文件"),
                    Subtitle = $"{GetString(file, "relativePath", "")} · {GetString(file, "size", "0")} bytes",
                    Data = file.Clone(),
                });
            }
        }
        SetDetail(_items.Count == 0 ? "暂无文件。" : "选择左侧文件预览。");
    }

    private async Task LoadPrivateContactsAsync(int loadVersion = 0)
    {
        loadVersion = loadVersion == 0 ? _pageLoadVersion : loadVersion;
        if (!IsCurrentPageLoad("messages", loadVersion)) return;
        SetListState("正在加载联系人", "读取已有私信联系人。");
        SetDetail("正在加载私信联系人...");
        var result = await ToolAsync("list_private_message_contacts");
        if (!IsCurrentPageLoad("messages", loadVersion)) return;
        _items.Clear();
        if (result.TryGetProperty("contacts", out var contacts) && contacts.ValueKind == JsonValueKind.Array)
        {
            foreach (var contact in contacts.EnumerateArray())
            {
                _items.Add(new DisplayItem
                {
                    Id = PrivateContactKey(contact),
                    Title = PrivateContactLabel(contact),
                    Subtitle = FormatPrivateContactSubtitle(contact),
                    Data = contact.Clone(),
                });
            }
        }
        SetDetail(_items.Count == 0 ? "暂无私信联系人。" : "选择左侧联系人读取线程。");
    }

    private async Task LoadDraftsAsync(string status, int loadVersion = 0)
    {
        loadVersion = loadVersion == 0 ? _pageLoadVersion : loadVersion;
        if (!IsCurrentPageLoad("drafts", loadVersion)) return;
        SetListState("正在加载草稿", "读取本地草稿记录。");
        SetDetail("正在加载草稿...");
        SetDraftActionButtons(false);
        var result = await ToolAsync("list_submission_drafts", new { status });
        if (!IsCurrentPageLoad("drafts", loadVersion)) return;
        _items.Clear();
        if (result.TryGetProperty("drafts", out var drafts) && drafts.ValueKind == JsonValueKind.Array)
        {
            foreach (var draft in drafts.EnumerateArray())
            {
                _items.Add(new DisplayItem
                {
                    Id = GetString(draft, "draftId", ""),
                    Title = GetString(draft, "taskTitle", $"任务 {GetString(draft, "taskId", "")}"),
                    Subtitle = $"{FormatDraftStatus(GetString(draft, "status", ""))} · {GetString(draft, "subjectName", "未知课程")}",
                    Data = draft.Clone(),
                });
            }
        }
        SetDetail(_items.Count == 0 ? "暂无草稿。" : "选择左侧草稿查看和编辑。");
        SetDraftActionButtons(_items.Count > 0);
    }

    private async Task OpenDraftCreatorAsync()
    {
        _draftCreateMode = true;
        _selectedDraft = null;
        _draftSubmitPreview = null;
        _draftMessagePreview = null;
        _items.Clear();
        ListTitleText.Text = "创建草稿";
        PrimaryComboBox.Visibility = Visibility.Visible;
        FilterComboBox.Visibility = Visibility.Visible;
        CommandInputBox.Visibility = Visibility.Visible;
        CommandInputBox.Text = "";
        CommandInputBox.PlaceholderText = "摘要，可选，例如：手动整理的初稿";
        DetailTextBox.Visibility = Visibility.Collapsed;
        EditorTextBox.Visibility = Visibility.Visible;
        EditorTextBox.Text = "";
        DetailTitleText.Text = "草稿正文";
        PrimaryActionButton.Content = "创建草稿";
        SecondaryActionButton.Content = "取消";
        ThirdActionButton.Content = "刷新课程";
        FourthActionButton.Visibility = Visibility.Collapsed;
        DangerActionButton.Visibility = Visibility.Collapsed;
        DetailPrimaryButton.Visibility = Visibility.Collapsed;
        DetailSecondaryButton.Visibility = Visibility.Collapsed;
        await LoadDraftCreateCoursesAsync();
    }

    private void CancelDraftCreator()
    {
        RenderDrafts();
        _ = LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "pending_review");
        SetStatus("已取消创建草稿");
    }

    private async Task LoadDraftCreateCoursesAsync()
    {
        var result = await ToolAsync("list_courses");
        var rows = ReadArray(result, "courses", "items", "records");
        _suppressComboEvents = true;
        PrimaryComboBox.Items.Clear();
        foreach (var row in rows.Where(row => GetString(row, "allSubjects", "false") != "true"))
        {
            PrimaryComboBox.Items.Add(new ComboItem
            {
                Key = GetCourseKey(row),
                Label = GetString(row, "name", "未命名课程"),
                Data = row.Clone(),
            });
        }
        PrimaryComboBox.SelectedIndex = PrimaryComboBox.Items.Count > 0 ? 0 : -1;
        _suppressComboEvents = false;
        await LoadDraftCreateTasksAsync();
    }

    private async Task LoadDraftCreateTasksAsync()
    {
        if (PrimaryComboBox.SelectedItem is not ComboItem course)
        {
            _suppressComboEvents = true;
            FilterComboBox.Items.Clear();
            _suppressComboEvents = false;
            SetStatus("暂无可创建草稿的课程");
            return;
        }

        var args = new Dictionary<string, object?>
        {
            ["list_type"] = "all",
            ["page"] = 1,
            ["size"] = 100,
            ["subject_name"] = course.Label,
        };
        var subjectId = GetString(course.Data, "id", "");
        var classId = GetString(course.Data, "classId", "");
        if (!string.IsNullOrWhiteSpace(subjectId)) args["subject_id"] = subjectId;
        if (!string.IsNullOrWhiteSpace(classId)) args["class_id"] = classId;

        var result = await ToolAsync("list_tasks", args);
        var rows = ExtractTaskRows(result).Where(task => !string.IsNullOrWhiteSpace(GetTaskId(task))).ToList();
        _suppressComboEvents = true;
        FilterComboBox.Items.Clear();
        foreach (var task in rows)
        {
            FilterComboBox.Items.Add(new ComboItem
            {
                Key = GetTaskId(task),
                Label = $"{GetTaskTitle(task)} · {GetTaskStatus(task)}",
                Data = task.Clone(),
            });
        }
        FilterComboBox.SelectedIndex = FilterComboBox.Items.Count > 0 ? 0 : -1;
        _suppressComboEvents = false;
        SetStatus(rows.Count > 0 ? $"已加载 {rows.Count} 个 task" : "这个课程暂无 task");
    }

    private async Task CreateManualDraftAsync()
    {
        if (!_draftCreateMode) return;
        if (PrimaryComboBox.SelectedItem is not ComboItem course)
        {
            SetStatus("请先选择课程");
            return;
        }
        if (FilterComboBox.SelectedItem is not ComboItem task)
        {
            SetStatus("请先选择 task");
            return;
        }
        var draftText = EditorTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(draftText))
        {
            SetStatus("请先填写草稿正文");
            return;
        }

        var result = await ToolAsync("draft_task_submission", new
        {
            task_id = task.Key,
            subject_name = course.Label,
            task_title = GetTaskTitle(task.Data),
            draft_text = draftText,
            summary = string.IsNullOrWhiteSpace(CommandInputBox.Text) ? "用户手动创建草稿" : CommandInputBox.Text.Trim(),
            evidence = Array.Empty<object>(),
            warnings = Array.Empty<string>(),
            missing_info = Array.Empty<string>(),
            needs_user_input = false,
        });
        var created = result.TryGetProperty("draft", out var inner) ? inner : result;
        var draftId = GetString(created, "draftId", GetString(result, "draftId", ""));
        RenderDrafts();
        await LoadDraftsAsync("pending_review");
        if (!string.IsNullOrWhiteSpace(draftId))
        {
            var draftResult = await ToolAsync("get_submission_draft", new { draft_id = draftId });
            var draft = draftResult.TryGetProperty("draft", out var draftInner) ? draftInner : draftResult;
            _selectedDraft = draft.Clone();
            ShowDraft(draft);
        }
        SetStatus("草稿已创建，状态为待审核");
    }

    private async Task LoadSettingsAsync(int loadVersion = 0)
    {
        loadVersion = loadVersion == 0 ? _pageLoadVersion : loadVersion;
        if (!IsCurrentPageLoad("settings", loadVersion)) return;
        SettingsModelStatusText.Text = "正在加载设置...";
        SettingsUpdateStatusText.Text = "加载中";
        var config = await InvokeAsync("config:model:load");
        var update = await InvokeAsync("update:status");
        if (!IsCurrentPageLoad("settings", loadVersion)) return;
        _items.Clear();
        ApplySettingsConfig(config);
        ApplyUpdateStatus(update);
        RenderSettingsPaths();
        SettingsOpenPathButton.Visibility = Visibility.Collapsed;
    }

    private void ApplySettingsConfig(JsonElement config)
    {
        _settingsHasApiKey = GetString(config, "hasApiKey", "false") == "true" || !string.IsNullOrWhiteSpace(GetString(config, "apiKeyMasked", ""));
        _settingsDefaultSystemPrompt = GetString(config, "defaultSystemPrompt", "");

        SettingsApiKeyBox.Password = "";
        SettingsApiKeyBox.PlaceholderText = _settingsHasApiKey
            ? $"已保存：{GetString(config, "apiKeyMasked", "******")}，留空则保留"
            : "请输入 API Key";
        SettingsBaseUrlBox.Text = GetString(config, "baseUrl", "");
        SettingsModelNameBox.Text = GetString(config, "modelName", "");
        SettingsContextLengthBox.Text = GetString(config, "contextLength", "");
        SettingsChatTemperatureBox.Text = GetString(config, "chatTemperature", "0.2");
        SettingsCompactTemperatureBox.Text = GetString(config, "compactTemperature", "0.1");
        SettingsMaxToolRoundsBox.Text = GetString(config, "maxToolRounds", "6");
        SettingsLongPasteThresholdBox.Text = GetString(config, "longPasteThreshold", "4000");
        SettingsSystemPromptBox.Text = GetString(config, "systemPrompt", "");
        SettingsThemeComboBox.SelectedIndex = SettingsThemeComboBox.SelectedIndex < 0 ? 0 : SettingsThemeComboBox.SelectedIndex;
        SettingsModelStatusText.Text = _settingsHasApiKey ? "API Key 已保存。留空保存不会覆盖已保存 Key。" : "API Key 未配置。";

        if (SettingsModelComboBox.Visibility == Visibility.Visible)
        {
            SelectSettingsModel(GetCurrentSettingsModelName());
        }
    }

    private void ApplyUpdateStatus(JsonElement update)
    {
        var updateDetail = update;
        if (update.TryGetProperty("update", out var nested) && nested.ValueKind == JsonValueKind.Object)
        {
            updateDetail = nested;
        }

        var currentVersion = _appInfo.HasValue ? GetString(_appInfo.Value, "version", "unknown") : "unknown";
        var latestVersion = FirstString(updateDetail, "latestVersion", "version", "tagName", "tag_name");
        var status = FirstString(update, "status", "message");
        SettingsVersionBadgeText.Text = $"v{currentVersion}";
        SettingsCurrentVersionText.Text = currentVersion;
        SettingsLatestVersionText.Text = string.IsNullOrWhiteSpace(latestVersion) ? "-" : latestVersion;
        SettingsUpdateStatusText.Text = string.IsNullOrWhiteSpace(status) ? "未检查" : UpdateStatusLabel(status);

        var title = FirstString(updateDetail, "latestTitle", "name", "title");
        var publishedAt = FirstString(updateDetail, "publishedAt", "published_at");
        var assetName = FirstString(updateDetail, "installerAsset.name", "assetName");
        var assetSize = FirstString(updateDetail, "installerAsset.size", "assetSize", "size");
        var notes = FirstString(updateDetail, "latestNotes", "body", "message");
        SettingsUpdateNotesText.Text = string.Join("\n", new[] {
            title,
            string.IsNullOrWhiteSpace(publishedAt) ? "" : $"发布时间：{publishedAt}",
            string.IsNullOrWhiteSpace(assetName) ? "" : $"安装包：{assetName}{(string.IsNullOrWhiteSpace(assetSize) ? "" : $" · {assetSize}")}",
            notes,
        }.Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private void RenderSettingsPaths()
    {
        _settingsPathItems.Clear();
        if (!_appInfo.HasValue) return;

        foreach (var row in SettingsPathRows(_appInfo.Value))
        {
            _settingsPathItems.Add(new DisplayItem
            {
                Id = row.Key,
                Title = row.Title,
                Subtitle = row.Description,
                Path = row.Path,
                Data = _appInfo.Value.Clone(),
            });
        }
    }

    private Dictionary<string, object> BuildSettingsConfig()
    {
        var modelName = GetCurrentSettingsModelName();
        var config = new Dictionary<string, object>
        {
            ["baseUrl"] = SettingsBaseUrlBox.Text.Trim(),
            ["modelName"] = modelName,
            ["contextLength"] = SettingsContextLengthBox.Text.Trim(),
            ["chatTemperature"] = SettingsChatTemperatureBox.Text.Trim(),
            ["compactTemperature"] = SettingsCompactTemperatureBox.Text.Trim(),
            ["maxToolRounds"] = SettingsMaxToolRoundsBox.Text.Trim(),
            ["longPasteThreshold"] = SettingsLongPasteThresholdBox.Text.Trim(),
            ["systemPrompt"] = SettingsSystemPromptBox.Text.Trim(),
        };

        if (!string.IsNullOrWhiteSpace(SettingsApiKeyBox.Password))
        {
            config["apiKey"] = SettingsApiKeyBox.Password.Trim();
        }

        return config;
    }

    private string GetCurrentSettingsModelName()
    {
        if (SettingsModelComboBox.Visibility == Visibility.Visible && SettingsModelComboBox.SelectedItem is ComboBoxItem item)
        {
            return (item.Tag?.ToString() ?? item.Content?.ToString() ?? "").Trim();
        }

        return SettingsModelNameBox.Text.Trim();
    }

    private void SelectSettingsModel(string modelName)
    {
        _suppressSettingsModelCombo = true;
        try
        {
            foreach (var item in SettingsModelComboBox.Items.OfType<ComboBoxItem>())
            {
                if (string.Equals(item.Tag?.ToString(), modelName, StringComparison.OrdinalIgnoreCase))
                {
                    SettingsModelComboBox.SelectedItem = item;
                    return;
                }
            }

            SettingsModelComboBox.SelectedIndex = SettingsModelComboBox.Items.Count > 0 ? 0 : -1;
        }
        finally
        {
            _suppressSettingsModelCombo = false;
        }
    }

    private static string UpdateStatusLabel(string status)
    {
        return status switch
        {
            "downloading" => "下载中",
            "verifying" => "校验中",
            "ready_to_install" => "等待安装",
            "installing" => "安装中",
            "error" => "出错",
            "checking" => "检查中",
            "available" => "有新版本",
            "idle" => "未检查",
            _ => status,
        };
    }

    private static IReadOnlyList<(string Key, string Title, string Description, string Path)> SettingsPathRows(JsonElement appInfo)
    {
        return new List<(string Key, string Title, string Description, string Path)>
        {
            ("userDataRoot", "应用数据目录", "保存模型配置、助手对话记录和本应用的本地状态。", GetString(appInfo, "userDataRoot", "")),
            ("dataRoot", "伴学邦数据目录", "保存伴学邦会话、工作区和草稿等业务数据。", GetString(appInfo, "dataRoot", "")),
            ("workspaceDir", "工作区", "保存用户导入文件、下载的作业附件和助手生成的本地文件。", GetString(appInfo, "workspaceDir", "")),
            ("draftDir", "草稿库", "保存待审核、已通过和已驳回的本地作业草稿。", GetString(appInfo, "draftDir", "")),
            ("updateDir", "更新缓存", "保存应用内下载的安装器、校验信息和待安装状态。", GetString(appInfo, "updateDir", "")),
            ("modelConfigPath", "模型配置文件", "保存 API Key、调用链接、模型名、Temperature 和系统提示词。", GetString(appInfo, "modelConfigPath", "")),
            ("conversationsPath", "助手对话记录", "保存本地助手会话、标题和上下文压缩后的历史。", GetString(appInfo, "conversationsPath", "")),
            ("payloadRoot", "程序负载目录", "保存打包随附的工具代码和运行依赖，通常不需要手动修改。", GetString(appInfo, "payloadRoot", "")),
            ("browserRoot", "浏览器依赖目录", "保存 Playwright/Chromium 依赖，供登录、网页搜索和页面读取使用。", GetString(appInfo, "browserDependency.browserRoot", "")),
        }.Where(row => !string.IsNullOrWhiteSpace(row.Path)).ToList();
    }

    private async void OnPrimaryActionClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            switch (_currentPage)
            {
                case "home":
                    await ToolAsync("login_in_browser");
                    await RefreshSessionAsync();
                    break;
                case "agent":
                    await SendAgentAsync();
                    break;
                case "homework":
                    await LoadTasksAsync();
                    break;
                case "workspace":
                    await LoadWorkspaceFilesAsync();
                    break;
                case "messages":
                    await LoadPrivateContactsAsync();
                    break;
                case "drafts":
                    if (_draftCreateMode)
                    {
                        await CreateManualDraftAsync();
                        break;
                    }
                    await LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "pending_review");
                    break;
                case "settings":
                    await LoadModelOptionsAsync();
                    break;
            }
        });
    }

    private async void OnSecondaryActionClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            switch (_currentPage)
            {
                case "home":
                    await RefreshSessionAsync();
                    break;
                case "agent":
                    await InvokeAsync("agent:conversations:create", new { title = "新对话" });
                    await LoadConversationsAsync();
                    break;
                case "homework":
                    await LoadHomeworkCoursesAsync();
                    break;
                case "workspace":
                    await InvokeAsync("workspace:open");
                    break;
                case "messages":
                    break;
                case "drafts":
                    if (_draftCreateMode)
                    {
                        CancelDraftCreator();
                        break;
                    }
                    await SaveDraftAsync();
                    break;
                case "settings":
                    await CheckUpdatesAsync();
                    break;
            }
        });
    }

    private async void OnThirdActionClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            switch (_currentPage)
            {
                case "home":
                    await InvokeAsync("app:open-path", new { key = "dataRoot" });
                    break;
                case "agent":
                    await InvokeAsync("agent:compact");
                    await LoadConversationsAsync();
                    break;
                case "drafts":
                    if (_draftCreateMode)
                    {
                        await LoadDraftCreateCoursesAsync();
                        break;
                    }
                    await ApproveDraftAsync();
                    break;
                case "settings":
                    await InvokeAsync("update:open-url");
                    break;
            }
        });
    }

    private async void OnFourthActionClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (_currentPage == "drafts")
            {
                await OpenDraftCreatorAsync();
            }
        });
    }

    private async void OnDangerActionClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (_currentPage == "agent")
            {
                var item = MainListView.SelectedItem as DisplayItem;
                if (item is null) return;
                if (!_deleteConversationArmed)
                {
                    _deleteConversationArmed = true;
                    SetStatus("再次点击确认删除对话。");
                    return;
                }
                await InvokeAsync("agent:conversations:delete", new { conversationId = item.Id });
                _deleteConversationArmed = false;
                await LoadConversationsAsync();
            }
            else if (_currentPage == "drafts")
            {
                await DeleteDraftAsync();
            }
        });
    }

    private async void OnDetailPrimaryClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (_currentPage != "drafts" || !_selectedDraft.HasValue) return;
            if (_draftSubmitPreview.HasValue)
            {
                await ConfirmDraftSubmitAsync();
                return;
            }
            if (_draftMessagePreview.HasValue)
            {
                await ConfirmDraftPrivateMessageAsync();
                return;
            }

            var target = GetString(_selectedDraft.Value, "deliveryTarget", GetString(_selectedDraft.Value, "preferredTarget", "task"));
            if (target == "teacher_private_message")
            {
                await PrepareDraftPrivateMessageAsync();
            }
            else
            {
                await PrepareDraftSubmitAsync();
            }
        });
    }

    private async void OnDetailSecondaryClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (_currentPage != "drafts" || !_selectedDraft.HasValue) return;
            if (_draftSubmitPreview.HasValue || _draftMessagePreview.HasValue)
            {
                _draftSubmitPreview = null;
                _draftMessagePreview = null;
                ShowDraft(_selectedDraft.Value);
                return;
            }
            await ToolAsync("reject_submission_draft", new { draft_id = GetString(_selectedDraft.Value, "draftId", ""), review_note = "WinUI rejected" });
            _selectedDraft = null;
            await LoadDraftsAsync("pending_review");
        });
    }

    private async void OnPrimaryComboChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_suppressComboEvents) return;
        if (_currentPage == "homework")
        {
            await RunUiAsync(() => LoadTasksAsync());
        }
        else if (_currentPage == "drafts" && _draftCreateMode)
        {
            await RunUiAsync(LoadDraftCreateTasksAsync);
        }
    }

    private async void OnConversationComboChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_suppressComboEvents || _currentPage != "agent") return;
        if (ConversationComboBox.SelectedItem is not ComboItem item) return;
        await RunUiAsync(async () =>
        {
            var selected = await InvokeAsync("agent:conversations:select", new { conversationId = item.Key });
            if (selected.TryGetProperty("activeConversation", out var active)) ShowConversation(active);
        });
    }

    private async void OnAgentNewConversationClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            await InvokeAsync("agent:conversations:create", new { title = "新对话" });
            AgentInputBox.Text = "";
            AgentStepsTextBox.Text = "已开始新对话。";
            await LoadConversationsAsync();
        });
    }

    private async void OnAgentDeleteConversationClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (ConversationComboBox.SelectedItem is not ComboItem item) return;
            if (!_deleteConversationArmed)
            {
                _deleteConversationArmed = true;
                SetStatus("再次点击确认删除对话。");
                return;
            }
            await InvokeAsync("agent:conversations:delete", new { conversationId = item.Key });
            _deleteConversationArmed = false;
            AgentStepsTextBox.Text = "对话已删除。";
            await LoadConversationsAsync();
        });
    }

    private async void OnAgentCompactClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            AgentStepsTextBox.Text = "正在压缩上下文...";
            await InvokeAsync("agent:compact", new { conversationId = (ConversationComboBox.SelectedItem as ComboItem)?.Key });
            AgentStepsTextBox.Text = "上下文已压缩。";
            await LoadConversationsAsync();
        });
    }

    private async void OnAgentSendClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(SendAgentAsync);
    }

    private async void OnFilterComboChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_suppressComboEvents) return;
        if (_currentPage == "homework")
        {
            await RunUiAsync(() => LoadTasksAsync());
        }
        else if (_currentPage == "drafts" && _draftCreateMode)
        {
            return;
        }
        else if (_currentPage == "drafts")
        {
            await RunUiAsync(() => LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "pending_review"));
        }
    }

    private async void OnMainListSelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (MainListView.SelectedItem is not DisplayItem item) return;
        if (IsStateItem(item)) return;
        await RunUiAsync(async () =>
        {
            switch (_currentPage)
            {
                case "home":
                case "settings":
                    SetDetail(FormatJson(item.Data));
                    break;
                case "agent":
                    var selected = await InvokeAsync("agent:conversations:select", new { conversationId = item.Id });
                    if (selected.TryGetProperty("activeConversation", out var active)) ShowConversation(active);
                    break;
                case "homework":
                    var detail = await ToolAsync("read_task_content", new { task_id = item.Id, max_chars = 6000 });
                    SetDetail(FormatTaskDetail(detail));
                    break;
                case "workspace":
                    await OpenWorkspaceItemAsync(item);
                    break;
                case "messages":
                    await OpenPrivateContactAsync(item);
                    break;
                case "drafts":
                    var draftResult = await ToolAsync("get_submission_draft", new { draft_id = item.Id });
                    var draft = draftResult.TryGetProperty("draft", out var inner) ? inner : draftResult;
                    _selectedDraft = draft.Clone();
                    _draftSubmitPreview = null;
                    _draftMessagePreview = null;
                    ShowDraft(draft);
                    break;
            }
        });
    }

    private async Task SendAgentAsync()
    {
        var text = AgentInputBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(text)) return;
        if (text == "/compact")
        {
            await InvokeAsync("agent:compact", new { conversationId = (ConversationComboBox.SelectedItem as ComboItem)?.Key });
            AgentInputBox.Text = "";
            AgentStepsTextBox.Text = "上下文已压缩。";
            await LoadConversationsAsync();
            return;
        }
        AgentInputBox.Text = "";
        _agentPreviewMessages.Add(new AgentChatMessage("user", text));
        _agentPreviewMessages.Add(new AgentChatMessage("assistant", "执行中..."));
        RenderAgentMessages(_agentPreviewMessages);
        AgentStepsTextBox.Text = "正在请求模型...";
        var result = await InvokeAsync("agent:chat", new { text, conversationId = (ConversationComboBox.SelectedItem as ComboItem)?.Key });
        _agentPreviewMessages[^1] = new AgentChatMessage("assistant", GetString(result, "message", "执行完成。"));
        RenderAgentMessages(_agentPreviewMessages);
        if (result.TryGetProperty("steps", out var steps))
        {
            AgentStepsTextBox.Text = FormatJson(steps);
        }
        await LoadConversationsAsync();
    }

    private async Task OpenWorkspaceItemAsync(DisplayItem item)
    {
        var category = GetString(item.Data, "category", "");
        var extension = GetString(item.Data, "extension", "").ToLowerInvariant();
        var isImage = category == "image" || new[] { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif" }.Contains(extension);
        if (isImage)
        {
            var image = await InvokeAsync("workspace:image-data-url", new { filePath = GetString(item.Data, "path", "") });
            await SetDetailImageAsync(image, item.Title);
            return;
        }
        var result = await ToolAsync("read_workspace_file", new { file = GetString(item.Data, "relativePath", item.Title), max_chars = 8000 });
        SetDetail(FormatWorkspacePreview(result));
    }

    private async Task OpenPrivateContactAsync(DisplayItem item)
    {
        var result = await ToolAsync("get_private_message_thread", new { contact = item.Data, size = 30 });
        ShowPrivateThread(item, result);
    }

    private async Task SendPrivateMessageAsync()
    {
        if (MainListView.SelectedItem is not DisplayItem item) return;
        var text = PrivateMessageInputBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(text)) return;
        await ToolAsync("send_private_message_text", new { contact = item.Data, content = text });
        PrivateMessageInputBox.Text = "";
        await OpenPrivateContactAsync(item);
    }

    private async void OnPrivateMessageSendClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(SendPrivateMessageAsync);
    }

    private async Task SaveDraftAsync()
    {
        if (!_selectedDraft.HasValue) return;
        var draftId = GetString(_selectedDraft.Value, "draftId", "");
        var text = EditorTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(draftId) || string.IsNullOrWhiteSpace(text)) return;
        var result = await ToolAsync("update_submission_draft", new { draft_id = draftId, draft_text = text });
        var draft = result.TryGetProperty("draft", out var inner) ? inner : result;
        _selectedDraft = draft.Clone();
        ShowDraft(draft);
        await LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "all");
    }

    private async Task ApproveDraftAsync()
    {
        if (!_selectedDraft.HasValue) return;
        var result = await ToolAsync("approve_submission_draft", new { draft_id = GetString(_selectedDraft.Value, "draftId", ""), review_note = "WinUI approved" });
        var draft = result.TryGetProperty("draft", out var inner) ? inner : result;
        _selectedDraft = draft.Clone();
        ShowDraft(draft);
        await LoadDraftsAsync("all");
    }

    private async Task DeleteDraftAsync()
    {
        if (!_selectedDraft.HasValue) return;
        if (!_deleteDraftArmed)
        {
            _deleteDraftArmed = true;
            SetStatus("再次点击确认删除草稿。");
            return;
        }
        await ToolAsync("delete_submission_draft", new { draft_id = GetString(_selectedDraft.Value, "draftId", "") });
        _selectedDraft = null;
        _deleteDraftArmed = false;
        await LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "pending_review");
    }

    private async Task PrepareDraftSubmitAsync()
    {
        if (!_selectedDraft.HasValue) return;
        var preview = await ToolAsync("prepare_draft_submission", new { draft_id = GetString(_selectedDraft.Value, "draftId", "") });
        _draftSubmitPreview = preview.Clone();
        DetailPrimaryButton.Content = "确认提交";
        DetailSecondaryButton.Content = "取消";
        SetDetail(FormatDraftSubmitPreview(preview));
        EditorTextBox.Visibility = Visibility.Collapsed;
        DetailTextBox.Visibility = Visibility.Visible;
    }

    private async Task ConfirmDraftSubmitAsync()
    {
        if (!_selectedDraft.HasValue || !_draftSubmitPreview.HasValue) return;
        var result = await ToolAsync("submit_approved_draft", new
        {
            draft_id = GetString(_selectedDraft.Value, "draftId", ""),
            confirmation_token = GetString(_draftSubmitPreview.Value, "confirmationToken", ""),
        });
        _draftSubmitPreview = null;
        var draft = result.TryGetProperty("draft", out var inner) ? inner : result;
        _selectedDraft = draft.Clone();
        ShowDraft(draft);
        await LoadDraftsAsync("all");
    }

    private async Task PrepareDraftPrivateMessageAsync()
    {
        if (!_selectedDraft.HasValue) return;
        var preview = await ToolAsync("prepare_draft_private_message", new { draft_id = GetString(_selectedDraft.Value, "draftId", "") });
        _draftMessagePreview = preview.Clone();
        DetailPrimaryButton.Content = "确认私信";
        DetailSecondaryButton.Content = "取消";
        SetDetail(FormatDraftPrivatePreview(preview));
        EditorTextBox.Visibility = Visibility.Collapsed;
        DetailTextBox.Visibility = Visibility.Visible;
    }

    private async Task ConfirmDraftPrivateMessageAsync()
    {
        if (!_selectedDraft.HasValue || !_draftMessagePreview.HasValue) return;
        if (!_draftMessagePreview.Value.TryGetProperty("selectedContact", out var contact))
        {
            SetStatus("没有选中私信联系人。第一版 WinUI 先使用自动匹配联系人。");
            return;
        }
        var result = await ToolAsync("send_approved_draft_private_message", new
        {
            draft_id = GetString(_selectedDraft.Value, "draftId", ""),
            contact,
            confirmation_token = GetString(_draftMessagePreview.Value, "confirmationToken", ""),
        });
        _draftMessagePreview = null;
        var draft = result.TryGetProperty("draft", out var inner) ? inner : result;
        _selectedDraft = draft.Clone();
        ShowDraft(draft);
        await LoadDraftsAsync("all");
    }

    private async Task LoadModelOptionsAsync()
    {
        var config = BuildSettingsConfig();
        SettingsModelStatusText.Text = "正在读取模型...";
        var result = await InvokeAsync("config:model:list", config);
        var models = ReadModelIds(result).ToList();

        _suppressSettingsModelCombo = true;
        try
        {
            SettingsModelComboBox.Items.Clear();
            var currentModel = GetCurrentSettingsModelName();
            if (!string.IsNullOrWhiteSpace(currentModel) && !models.Contains(currentModel, StringComparer.OrdinalIgnoreCase))
            {
                SettingsModelComboBox.Items.Add(new ComboBoxItem { Content = $"{currentModel}（当前）", Tag = currentModel });
            }
            foreach (var model in models)
            {
                SettingsModelComboBox.Items.Add(new ComboBoxItem { Content = model, Tag = model });
            }
            SettingsModelNameBox.Visibility = Visibility.Collapsed;
            SettingsModelComboBox.Visibility = Visibility.Visible;
            SelectSettingsModel(currentModel);
        }
        finally
        {
            _suppressSettingsModelCombo = false;
        }

        SettingsModelStatusText.Text = models.Count == 0
            ? "连接成功，但没有读取到模型名称。"
            : $"已读取 {models.Count} 个模型。";
    }

    private async Task CheckUpdatesAsync()
    {
        var result = await InvokeAsync("update:check");
        ApplyUpdateStatus(result);
        SetStatus("更新检查完成");
    }

    private void OnSettingsPathSelectionChanged(object sender, SelectionChangedEventArgs args)
    {
    }

    private async void OnSettingsOpenPathClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (_currentPage != "settings" || SettingsPathListView.SelectedItem is not DisplayItem item) return;
            await InvokeAsync("app:open-path", new { key = item.Id });
            SetStatus("已打开路径");
        });
    }

    private async void OnSettingsPathItemOpenClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (_currentPage != "settings" || sender is not Button { Tag: string key }) return;
            await InvokeAsync("app:open-path", new { key });
            SetStatus("已打开路径");
        });
    }

    private async void OnSettingsSaveConfigClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            var config = await InvokeAsync("config:model:save", BuildSettingsConfig());
            ApplySettingsConfig(config);
            SetStatus("设置已保存");
        });
    }

    private async void OnSettingsTestConfigClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            SettingsModelStatusText.Text = "正在测试连通性...";
            var result = await InvokeAsync("config:model:test", BuildSettingsConfig());
            SettingsModelStatusText.Text = GetString(result, "message", "测试完成");
            SetStatus("模型连通性测试完成");
        });
    }

    private async void OnSettingsClearConfigClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            var config = await InvokeAsync("config:model:clear");
            SettingsModelNameBox.Visibility = Visibility.Visible;
            SettingsModelComboBox.Visibility = Visibility.Collapsed;
            SettingsModelComboBox.Items.Clear();
            ApplySettingsConfig(config);
            SetStatus("模型配置已清除");
        });
    }

    private void OnSettingsRestoreDefaultPromptClick(object sender, RoutedEventArgs args)
    {
        SettingsSystemPromptBox.Text = _settingsDefaultSystemPrompt;
        SetStatus("已恢复默认提示词，点击保存设置后生效");
    }

    private async void OnSettingsLoadModelsClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(LoadModelOptionsAsync);
    }

    private async void OnSettingsCheckUpdatesClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(CheckUpdatesAsync);
    }

    private async void OnSettingsOpenReleaseClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () => await InvokeAsync("update:open-url"));
    }

    private void OnSettingsModelSelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_suppressSettingsModelCombo || SettingsModelComboBox.SelectedItem is not ComboBoxItem item) return;
        SettingsModelNameBox.Text = (item.Tag?.ToString() ?? item.Content?.ToString() ?? "").Replace("（当前）", "");
    }

    private async Task SetDetailImageAsync(JsonElement image, string fallbackTitle)
    {
        var fileName = GetString(image, "fileName", fallbackTitle);
        var mimeType = GetString(image, "mimeType", "");
        var path = GetString(image, "path", "");
        var dataUrl = GetString(image, "dataUrl", "");

        DetailTitleText.Text = fileName;
        DetailTextBox.Visibility = Visibility.Collapsed;
        EditorTextBox.Visibility = Visibility.Collapsed;
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        DetailImageScrollViewer.Visibility = Visibility.Visible;
        DetailImageCaption.Text = $"{mimeType}\n{path}";

        var bitmap = new BitmapImage();
        if (dataUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && dataUrl.Contains(','))
        {
            var base64 = dataUrl[(dataUrl.IndexOf(',') + 1)..];
            var bytes = Convert.FromBase64String(base64);
            using var stream = new InMemoryRandomAccessStream();
            await stream.WriteAsync(bytes.AsBuffer());
            stream.Seek(0);
            await bitmap.SetSourceAsync(stream);
        }
        else if (!string.IsNullOrWhiteSpace(path))
        {
            bitmap.UriSource = new Uri(path);
        }
        WorkspaceImagePreview.Source = bitmap;
    }

    private void SetAgentTranscriptPlain(string text)
    {
        _agentPreviewMessages.Clear();
        RenderAgentMessages(new[] { new AgentChatMessage("assistant", text) });
    }

    private void RenderAgentMessages(IReadOnlyList<AgentChatMessage> messages)
    {
        var snapshot = messages.ToList();
        RenderAgentFallback(snapshot);
        if (AgentPanel.Visibility == Visibility.Visible && !_agentMarkdownWebViewUnavailable)
        {
            var version = ++_agentMarkdownRenderVersion;
            _ = RenderAgentMarkdownAsync(snapshot, version);
        }
    }

    private async Task RenderAgentMarkdownAsync(IReadOnlyList<AgentChatMessage> messages, int version)
    {
        try
        {
            _agentMarkdownWebView ??= CreateAgentMarkdownWebView();
            await _agentMarkdownWebView.EnsureCoreWebView2Async();
            if (version != _agentMarkdownRenderVersion)
            {
                return;
            }
            _agentMarkdownWebView.NavigateToString(MarkdownHtmlRenderer.RenderConversation(messages.Select(message => (message.Role, message.Text))));
            AgentMarkdownFallbackTextBox.Visibility = Visibility.Collapsed;
            _agentMarkdownWebView.Visibility = Visibility.Visible;
        }
        catch (Exception error)
        {
            _agentMarkdownWebViewUnavailable = true;
            App.LogException(error);
            if (_agentMarkdownWebView is not null)
            {
                AgentMarkdownHost.Children.Remove(_agentMarkdownWebView);
                _agentMarkdownWebView = null;
            }
            RenderAgentFallback(messages);
        }
    }

    private WebView2 CreateAgentMarkdownWebView()
    {
        var webView = new WebView2();
        AgentMarkdownHost.Children.Insert(0, webView);
        return webView;
    }

    private void RenderAgentFallback(IReadOnlyList<AgentChatMessage> messages)
    {
        AgentMarkdownFallbackTextBox.Visibility = Visibility.Visible;
        AgentMarkdownFallbackTextBox.Text = string.Join(
            "\n\n",
            messages.Select(message =>
            {
                var label = message.Role == "user" ? "你" : "助手";
                return $"{label}:\n{message.Text}";
            }));
    }

    private void ShowConversation(JsonElement conversation)
    {
        _agentPreviewMessages.Clear();
        if (conversation.TryGetProperty("messages", out var messages) && messages.ValueKind == JsonValueKind.Array)
        {
            foreach (var message in messages.EnumerateArray())
            {
                var role = GetString(message, "role", "") == "user" ? "user" : "assistant";
                _agentPreviewMessages.Add(new AgentChatMessage(role, FirstString(message, "text", "content", "message")));
            }
        }
        RenderAgentMessages(_agentPreviewMessages);
    }

    private void ShowDraft(JsonElement draft)
    {
        DetailTitleText.Text = GetString(draft, "taskTitle", $"任务 {GetString(draft, "taskId", "")}");
        DetailPrimaryButton.Content = "准备提交/私信";
        DetailSecondaryButton.Content = "驳回";
        SetDraftActionButtons(true);
        DetailTextBox.Visibility = Visibility.Collapsed;
        EditorTextBox.Visibility = Visibility.Visible;
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        EditorTextBox.Text = GetString(draft, "draftText", "");
        SetStatus($"{FormatDraftStatus(GetString(draft, "status", ""))} · {GetString(draft, "subjectName", "未知课程")}");
    }

    private void ShowPrivateThread(DisplayItem item, JsonElement result)
    {
        DetailTitleText.Text = PrivateContactLabel(item.Data);
        DetailTextBox.Visibility = Visibility.Collapsed;
        EditorTextBox.Visibility = Visibility.Collapsed;
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        WorkspaceImagePreview.Source = null;
        DetailImageCaption.Text = "";
        PrivateThreadListView.Visibility = Visibility.Visible;
        PrivateMessageComposerPanel.Visibility = Visibility.Visible;
        _privateThreadMessages.Clear();

        if (result.TryGetProperty("messages", out var messages) && messages.ValueKind == JsonValueKind.Array)
        {
            foreach (var message in messages.EnumerateArray())
            {
                _privateThreadMessages.Add(new PrivateThreadMessage
                {
                    Sender = PrivateMessageSenderLabel(message, item.Data),
                    Time = FirstString(message, "createTime", "time", "sendTime"),
                    Content = FirstString(message, "content", "text", "messageContent"),
                    Alignment = IsOwnPrivateMessage(message) ? HorizontalAlignment.Right : HorizontalAlignment.Left,
                });
            }
        }

        if (_privateThreadMessages.Count == 0)
        {
            _privateThreadMessages.Add(new PrivateThreadMessage { Sender = "系统", Time = "", Content = "暂无消息。" });
        }
    }

    private static IReadOnlyList<JsonElement> ReadArray(JsonElement root, params string[] names)
    {
        foreach (var name in names)
        {
            if (root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array)
            {
                return value.EnumerateArray().Select(item => item.Clone()).ToList();
            }
        }
        return Array.Empty<JsonElement>();
    }

    private static IReadOnlyList<string> ReadModelIds(JsonElement result)
    {
        foreach (var name in new[] { "modelIds", "models", "data", "items" })
        {
            if (!result.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array) continue;
            return value.EnumerateArray()
                .Select(model => model.ValueKind == JsonValueKind.String ? model.GetString() ?? "" : FirstString(model, "id", "name", "model"))
                .Where(model => !string.IsNullOrWhiteSpace(model))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        return Array.Empty<string>();
    }

    private static IReadOnlyList<JsonElement> ExtractTaskRows(JsonElement result)
    {
        var rows = new List<JsonElement>();
        foreach (var name in new[] { "pendingHomeworkList", "unsubmittedHomeworkList", "homeworkList", "tasks", "items", "records" })
        {
            if (result.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array)
            {
                rows.AddRange(value.EnumerateArray().Select(item => item.Clone()));
            }
        }
        return rows.GroupBy(GetTaskId).Select(group => group.First()).ToList();
    }

    private static string GetTaskId(JsonElement task) => FirstString(task, "task_id", "taskId", "id", "activityId");
    private static string GetTaskTitle(JsonElement task) => FirstString(task, "name", "title", "activityName", "taskTitle");
    private static string GetTaskDeadline(JsonElement task) => FirstString(task, "deadline", "endTime", "endDate");
    private static string GetTaskStatus(JsonElement task) => FirstString(task, "__statusText", "statusText", "score", "level", "scoreLevel", "scoreTypeName");
    private static string GetTaskCourse(JsonElement task) => FirstString(task, "course", "subjectName", "subject", "courseName");
    private static string GetCourseKey(JsonElement course) => $"{FirstString(course, "id", "courseId")}:{FirstString(course, "classId")}";

    private static string FirstString(JsonElement root, params string[] names)
    {
        foreach (var name in names)
        {
            var value = GetString(root, name, "");
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return "";
    }

    private static string GetString(JsonElement root, string path, string fallback)
    {
        var current = root;
        foreach (var part in path.Split('.'))
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(part, out current))
            {
                return fallback;
            }
        }

        return current.ValueKind switch
        {
            JsonValueKind.String => current.GetString() ?? fallback,
            JsonValueKind.Number => current.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => fallback,
            _ => current.ToString(),
        };
    }

    private static string FormatJson(JsonElement element) => JsonSerializer.Serialize(element, PrettyJsonOptions);

    private static string FormatSessionSummary(JsonElement session)
    {
        var ready = GetString(session, "ready", "false") == "true" ? "已登录" : "未登录";
        var user = GetString(session, "user.name", "未知用户");
        var subject = GetString(session, "currentSubject.name", "未知课程");
        var className = GetString(session, "currentClass.name", "未知班级");
        var term = GetString(session, "currentTermId", "未知学期");
        var pending = GetString(session, "currentSubject.unSubmitCount", "0");
        var sessionFile = GetString(session, "sessionFile", "");
        return $"状态：{ready}\n用户：{user}\n班级：{className}\n当前课程：{subject}\n待处理作业：{pending}\n学期 ID：{term}\n\n会话文件\n{sessionFile}";
    }

    private static string FormatSettingsSummary(JsonElement config, JsonElement update)
    {
        var apiKeyState = string.IsNullOrWhiteSpace(GetString(config, "apiKey", "")) ? "未配置" : "已配置";
        return
            "模型配置\n" +
            $"API Key：{apiKeyState}\n" +
            $"调用链接：{GetString(config, "baseUrl", "")}\n" +
            $"模型名称：{GetString(config, "modelName", "")}\n" +
            $"上下文长度：{GetString(config, "contextLength", "")}\n" +
            $"聊天 Temperature：{GetString(config, "chatTemperature", "")}\n" +
            $"压缩 Temperature：{GetString(config, "compactTemperature", "")}\n\n" +
            "软件更新\n" +
            $"状态：{GetString(update, "status", "")}\n" +
            $"信息：{GetString(update, "message", "")}";
    }

    private static string FormatModelListSummary(JsonElement config, JsonElement result)
    {
        var models = ReadArray(result, "models", "data", "items").Select(model => FirstString(model, "id", "name", "model")).Where(value => !string.IsNullOrWhiteSpace(value)).ToList();
        var modelText = models.Count == 0 ? "未读取到模型列表。" : string.Join("\n", models.Take(80));
        return
            "可用模型\n" +
            $"当前模型：{GetString(config, "modelName", "")}\n" +
            $"模型数量：{models.Count}\n\n" +
            modelText;
    }

    private static string FormatUpdateSummary(JsonElement update)
    {
        return
            "更新检查\n" +
            $"状态：{GetString(update, "status", "")}\n" +
            $"当前版本：{GetString(update, "currentVersion", GetString(update, "version", ""))}\n" +
            $"最新版本：{GetString(update, "latestVersion", "")}\n" +
            $"发布时间：{GetString(update, "publishedAt", "")}\n" +
            $"大小：{GetString(update, "assetSize", GetString(update, "size", ""))}\n\n" +
            GetString(update, "message", "");
    }

    private void SetListState(string title, string subtitle)
    {
        _items.Clear();
        _items.Add(new DisplayItem
        {
            Id = $"__state_{Guid.NewGuid():N}",
            Title = title,
            Subtitle = subtitle,
        });
    }

    private static bool IsStateItem(DisplayItem item) => item.Id.StartsWith("__state_", StringComparison.Ordinal);

    private void SetPageError(string message)
    {
        var cleanMessage = CleanErrorMessage(message);
        SetStatus(cleanMessage);
        if (_currentPage == "agent")
        {
            SetAgentTranscriptPlain(cleanMessage);
            AgentStepsTextBox.Text = "加载失败。";
            return;
        }
        if (_currentPage == "settings")
        {
            SettingsMainTextBox.Text = cleanMessage;
            return;
        }
        SetListState("加载失败", cleanMessage);
        SetDetail(cleanMessage);
    }

    private void SetDetail(string text)
    {
        DetailTextBox.Visibility = Visibility.Visible;
        EditorTextBox.Visibility = Visibility.Collapsed;
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        WorkspaceImagePreview.Source = null;
        DetailImageCaption.Text = "";
        DetailTextBox.Text = text;
    }

    private void SetDraftActionButtons(bool visible)
    {
        if (_currentPage != "drafts") return;
        DetailPrimaryButton.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        DetailSecondaryButton.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
    }

    private void SetStatus(string text)
    {
        var firstLine = CleanErrorMessage(text);
        StatusText.Text = firstLine.Length > 160 ? $"{firstLine[..157]}..." : firstLine;
    }

    private async Task RunUiAsync(Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (Exception error)
        {
            var cleanMessage = CleanErrorMessage(error.Message);
            SetStatus(cleanMessage);
            if (string.IsNullOrWhiteSpace(DetailTextBox.Text) || DetailTextBox.Visibility == Visibility.Visible)
            {
                SetDetail(cleanMessage);
            }
        }
    }

    private static string CleanErrorMessage(string? message)
    {
        var text = message ?? "";
        var firstLine = text.Replace("\r", "\n").Split('\n').FirstOrDefault() ?? "";
        return firstLine.StartsWith("Error: ", StringComparison.Ordinal) ? firstLine[7..] : firstLine;
    }

    private static string FormatTaskDetail(JsonElement detail)
    {
        var title = FirstString(detail, "taskSummary.activityName", "taskSummary.title", "taskSummary.name", "taskTitle");
        var course = FirstString(detail, "taskSummary.courseName", "context.currentSubject.name", "subjectName");
        var deadline = FirstString(detail, "taskSummary.endTime", "taskSummary.deadline", "taskSummary.endDate");
        var status = FirstString(detail, "taskSummary.__statusText", "taskSummary.statusText", "taskSummary.score", "taskSummary.scoreLevel");
        var content = FirstString(detail, "content", "readableText", "text", "taskText");
        var answer = FirstString(detail, "answer", "answerText", "referenceAnswer");

        var sections = new List<string>
        {
            title.Length > 0 ? title : "未命名作业",
            string.Join("\n", new[]
            {
                string.IsNullOrWhiteSpace(course) ? null : $"课程：{course}",
                string.IsNullOrWhiteSpace(deadline) ? null : $"截止：{deadline}",
                string.IsNullOrWhiteSpace(status) ? null : $"状态：{status}",
            }.Where(value => !string.IsNullOrWhiteSpace(value))),
        };

        sections.Add(string.IsNullOrWhiteSpace(content)
            ? "作业内容\n暂无可读取正文。"
            : $"作业内容\n{content}");

        if (!string.IsNullOrWhiteSpace(answer))
        {
            sections.Add($"参考/答案\n{answer}");
        }

        var attachments = FormatTaskAttachments(detail);
        if (!string.IsNullOrWhiteSpace(attachments))
        {
            sections.Add($"附件\n{attachments}");
        }

        var footer = string.Join("\n", new[]
        {
            GetString(detail, "contentTruncated", "false") == "true" ? "作业正文已截断。" : null,
            GetString(detail, "answerTruncated", "false") == "true" ? "参考/答案已截断。" : null,
        }.Where(value => !string.IsNullOrWhiteSpace(value)));
        if (!string.IsNullOrWhiteSpace(footer))
        {
            sections.Add(footer);
        }

        return string.Join("\n\n", sections.Where(section => !string.IsNullOrWhiteSpace(section)));
    }

    private static string FormatTaskAttachments(JsonElement detail)
    {
        if (!detail.TryGetProperty("attachments", out var attachments) || attachments.ValueKind != JsonValueKind.Array)
        {
            return "";
        }

        var rows = attachments.EnumerateArray()
            .Select((attachment, index) =>
            {
                var name = FirstString(attachment, "fileName", "name", "filename");
                var fileId = FirstString(attachment, "fileId", "id");
                var size = FirstString(attachment, "fileSize", "size", "sizeBytes");
                var source = FirstString(attachment, "source");
                var label = string.IsNullOrWhiteSpace(name) ? $"附件 {index + 1}" : name;
                var meta = string.Join(" · ", new[] { string.IsNullOrWhiteSpace(source) ? null : source, string.IsNullOrWhiteSpace(size) ? null : $"{size} bytes", string.IsNullOrWhiteSpace(fileId) ? null : $"ID {fileId}" }.Where(value => !string.IsNullOrWhiteSpace(value)));
                return string.IsNullOrWhiteSpace(meta) ? $"- {label}" : $"- {label}（{meta}）";
            })
            .ToList();

        return rows.Count == 0 ? "" : string.Join("\n", rows);
    }

    private static string FormatWorkspacePreview(JsonElement result)
    {
        if (result.TryGetProperty("file", out var file))
        {
            return FirstString(file, "text", "content", "preview") is { Length: > 0 } text ? text : FormatJson(file);
        }
        return FormatJson(result);
    }

    private static string FormatPrivateThread(JsonElement result)
    {
        if (!result.TryGetProperty("messages", out var messages) || messages.ValueKind != JsonValueKind.Array)
        {
            return FormatJson(result);
        }
        return string.Join("\n\n", messages.EnumerateArray().Select(message =>
            $"{FirstString(message, "senderName", "fromName", "sender", "name")} · {FirstString(message, "createTime", "time", "sendTime")}\n{FirstString(message, "content", "text", "messageContent")}"));
    }

    private static string FormatDraftStatus(string status) => status switch
    {
        "pending_review" => "待审核",
        "approved" => "已通过",
        "rejected" => "已驳回",
        "submitted" => "已提交到作业",
        "sent_to_teacher" => "已私信老师",
        _ => string.IsNullOrWhiteSpace(status) ? "未知" : status,
    };

    private static string FormatDraftSubmitPreview(JsonElement preview)
    {
        return $"提交预览\n目标：{FirstString(preview, "modeLabel", "targetLabel")}\n可提交：{GetString(preview, "canSubmit", "false")}\n\n{FirstString(preview, "text", "draftText", "submissionText")}\n\n{FormatJson(preview)}";
    }

    private static string FormatDraftPrivatePreview(JsonElement preview)
    {
        var chunks = preview.TryGetProperty("chunks", out var value) && value.ValueKind == JsonValueKind.Array
            ? string.Join("\n\n", value.EnumerateArray().Select((chunk, index) => $"第 {index + 1} 条\n{chunk}"))
            : "";
        return $"私信预览\n联系人：{(preview.TryGetProperty("selectedContact", out var contact) ? PrivateContactLabel(contact) : "未选择")}\n可发送：{GetString(preview, "canSend", "false")}\n\n{chunks}\n\n{FormatJson(preview)}";
    }

    private static string PrivateContactKey(JsonElement contact)
    {
        return FirstString(contact, "id", "peerId", "userId", "teacherId", "contactId", "roomId", "conversationId", "peerName", "name", "userName");
    }

    private static string PrivateContactLabel(JsonElement contact)
    {
        return FirstString(contact, "peerName", "teacherName", "contactName", "userName", "name", "nickName", "realName", "title", "lastContent");
    }

    private static string FormatPrivateContactSubtitle(JsonElement contact)
    {
        var lastTime = FirstString(contact, "lastTime", "updateTime", "createTime");
        var course = FirstString(contact, "courseName", "className");
        var lastContent = FirstString(contact, "lastContent", "lastMessage", "content");
        return string.Join(" · ", new[] { course, lastTime, lastContent }.Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private static string PrivateMessageSenderLabel(JsonElement message, JsonElement contact)
    {
        if (IsOwnPrivateMessage(message))
        {
            return "你";
        }

        return FirstString(message, "senderName", "fromName", "sender", "name", "receiverName", "toName") is { Length: > 0 } sender
            ? sender
            : PrivateContactLabel(contact);
    }

    private static bool IsOwnPrivateMessage(JsonElement message)
    {
        return FirstString(message, "senderType", "fromType") == "S";
    }
}
