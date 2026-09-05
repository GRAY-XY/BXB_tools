using System.Collections.ObjectModel;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using BxbHomework.WinUI.Services;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.ApplicationModel.DataTransfer;
using Windows.Security.Credentials;
using Windows.Storage;
using Windows.System;
using Windows.UI.Core;
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

internal sealed record AgentChatMessage(string Id, string Role, string Text, JsonElement? Steps = null, bool IsRunning = false);

internal sealed record AttachmentDownloadRequest(string TaskId, string FileId, string FileName);

internal sealed record ModelProviderPreset(string Type, string Name, string BaseUrl, string ModelName);

public sealed partial class MainWindow : Window
{
    private const string BanxuebangCredentialResource = "com.grayxy.bxbhomework.banxuebang";
    private const int MaxAgentInputImages = 8;
    private const long MaxAgentInputImageBytes = 25L * 1024 * 1024;
    private static readonly JsonSerializerOptions PrettyJsonOptions = new() { WriteIndented = true };
    private static readonly HashSet<string> SupportedClipboardImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif",
    };
    private static readonly IReadOnlyList<ModelProviderPreset> ModelProviderPresets = new[]
    {
        new ModelProviderPreset("moonshot", "Moonshot", "https://api.moonshot.cn/v1", "kimi-k2.5"),
        new ModelProviderPreset("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat"),
        new ModelProviderPreset("openai", "OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"),
        new ModelProviderPreset("qwen", "通义千问", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
        new ModelProviderPreset("custom", "自定义 OpenAI 兼容", "", ""),
    };
    private readonly NodeBackendClient _backend = new();
    private readonly ObservableCollection<DisplayItem> _items = new();
    private readonly ObservableCollection<DisplayItem> _agentConversationItems = new();
    private readonly ObservableCollection<DisplayItem> _agentComposerFiles = new();
    private readonly List<DisplayItem> _agentConversationCache = new();
    private readonly ObservableCollection<DisplayItem> _settingsProviderItems = new();
    private readonly ObservableCollection<DisplayItem> _settingsPathItems = new();
    private readonly ObservableCollection<PrivateThreadMessage> _privateThreadMessages = new();
    private string _currentPage = "home";
    private JsonElement? _session;
    private JsonElement? _appInfo;
    private JsonElement? _selectedDraft;
    private JsonElement? _draftSubmitPreview;
    private JsonElement? _draftMessagePreview;
    private readonly List<AgentChatMessage> _agentPreviewMessages = new();
    private readonly HashSet<string> _expandedAgentProcessIds = new(StringComparer.Ordinal);
    private WebView2? _agentMarkdownWebView;
    private bool _agentMarkdownWebViewUnavailable;
    private int _agentMarkdownRenderVersion;
    private string _selectedAgentMessageId = "";
    private string _activeConversationId = "";
    private bool _suppressAgentConversationEvents;
    private bool _agentConversationPaneCollapsed;
    private bool _agentConversationPaneAutoCollapsed;
    private bool _agentShouldFollowLatest = true;
    private double _agentScrollTop;
    private bool _agentRequestRunning;
    private bool _agentStopRequested;
    private string _runningAgentMessageId = "";
    private bool _suppressComboEvents;
    private bool _deleteDraftArmed;
    private bool _deleteConversationArmed;
    private bool _draftCreateMode;
    private int _pageLoadVersion;
    private bool _settingsHasApiKey;
    private string _settingsModelRole = "chat";
    private string _settingsDefaultCustomInstructions = "";
    private JsonElement? _settingsConfig;
    private bool _suppressSettingsProviderCombo;
    private bool _suppressSettingsProviderTypeCombo;
    private bool _suppressSettingsModelCombo;
    private bool _suppressSettingsThemeCombo;
    private bool _suppressSettingsImageCaptionEnabled;
    private bool _deleteProviderArmed;
    private bool _homeHasSavedCredential;
    private bool _homeLoginRunning;
    private bool _startupComplete;
    private bool _startupInitializing;

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        SetWindowIcon();
        MainListView.ItemsSource = _items;
        AgentConversationListView.ItemsSource = _agentConversationItems;
        AgentComposerFilesListView.ItemsSource = _agentComposerFiles;
        SettingsProviderListView.ItemsSource = _settingsProviderItems;
        SettingsPathListView.ItemsSource = _settingsPathItems;
        PrivateThreadListView.ItemsSource = _privateThreadMessages;

        _backend.LogReceived += (_, message) => DispatcherQueue.TryEnqueue(() => SetStatus(message));
        _backend.ProgressReceived += OnBackendProgressReceived;

        LoadSavedLoginCredential();
        _ = InitializeAsync();
    }

    private void SetWindowIcon()
    {
        try
        {
            var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "BxbIcon.ico");
            if (!File.Exists(iconPath))
            {
                return;
            }

            var windowHandle = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var windowId = Win32Interop.GetWindowIdFromWindow(windowHandle);
            AppWindow.GetFromWindowId(windowId).SetIcon(iconPath);
        }
        catch
        {
            // Icon setup is cosmetic and should never prevent the app from opening.
        }
    }

    private async Task InitializeAsync()
    {
        if (_startupInitializing || _startupComplete) return;
        _startupInitializing = true;
        StartupTitleText.Text = "BXB Homework";
        StartupStatusText.Text = "正在启动本地服务...";
        StartupProgressRing.IsActive = true;
        StartupProgressRing.Visibility = Visibility.Visible;
        StartupRetryButton.Visibility = Visibility.Collapsed;
        BackendStateText.Visibility = Visibility.Collapsed;
        try
        {
            await _backend.EnsureStartedAsync();

            StartupStatusText.Text = "正在读取应用配置...";
            var appInfoTask = InvokeAsync("app:info");
            var configTask = InvokeAsync("config:model:load");
            await Task.WhenAll(appInfoTask, configTask);
            _appInfo = await appInfoTask;
            BackendStateText.Text = $"Node {_appInfo.Value.GetProperty("nodeVersion").GetString()}";
            var config = await configTask;
            ApplyTheme(GetString(config, "theme", "light"));

            StartupStatusText.Text = "正在恢复登录状态...";
            await RefreshSessionAsync();
            RootNavigation.SelectedItem = RootNavigation.MenuItems[0];
            RenderHome();
            SetHomeSessionList();

            _startupComplete = true;
            RootNavigation.Visibility = Visibility.Visible;
            BackendStateText.Visibility = Visibility.Visible;
            StartupOverlay.Visibility = Visibility.Collapsed;
            SetStatus("Ready");
        }
        catch (Exception error)
        {
            StartupTitleText.Text = "启动失败";
            StartupStatusText.Text = error.Message;
            StartupProgressRing.IsActive = false;
            StartupProgressRing.Visibility = Visibility.Collapsed;
            StartupRetryButton.Visibility = Visibility.Visible;
            App.LogException(error);
        }
        finally
        {
            _startupInitializing = false;
        }
    }

    private void OnStartupRetryClick(object sender, RoutedEventArgs args)
    {
        _ = InitializeAsync();
    }

    private void OnNavigationSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (!_startupComplete) return;
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
                    await LoadAgentModelSummaryAsync(loadVersion);
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
                    await LoadDraftsAsync("all", loadVersion);
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
        HomeworkDetailScrollViewer.Visibility = Visibility.Collapsed;
        HomeworkDetailStackPanel.Children.Clear();
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        PrivateMessageComposerPanel.Visibility = Visibility.Collapsed;
        PrivateMessageInputBox.Text = "";
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        WorkspaceImagePreview.Source = null;
        DetailImageCaption.Text = "";
        DetailDocumentWebView.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Source = new Uri("about:blank");
        CommandInputBox.Text = "";
        CommandInputBox.Visibility = Visibility.Collapsed;
        HomeTermComboBox.Items.Clear();
        HomeTermComboBox.IsEnabled = true;
        ToolbarCard.Visibility = Visibility.Visible;
        PageHeaderPanel.Visibility = Visibility.Visible;
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
        ThirdActionButton.IsEnabled = true;
        DangerActionButton.IsEnabled = true;
        DetailPrimaryButton.Visibility = Visibility.Collapsed;
        DetailSecondaryButton.Visibility = Visibility.Collapsed;
        SetAgentStepsMessage("");
        AgentStepsDrawer.Visibility = Visibility.Collapsed;
        _settingsProviderItems.Clear();
        SettingsProviderTypeComboBox.Items.Clear();
        SettingsProviderNameBox.Text = "";
        SettingsProviderTitleText.Text = "模型配置";
        SettingsProviderEndpointText.Text = "";
        SettingsModelRoleTabView.SelectedIndex = 0;
        _settingsModelRole = "chat";
        SettingsNewProviderNameBox.Text = "";
        SettingsNewProviderBaseUrlBox.Text = "";
        SettingsNewProviderApiKeyBox.Password = "";
        SettingsNewProviderModelNameBox.Text = "";
        SettingsProviderCreatePanel.Visibility = Visibility.Collapsed;
        SettingsAddProviderButton.Content = "+ 新增";
        SettingsDeleteProviderButton.Content = "删除提供商";
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
        _settingsConfig = null;
        _deleteProviderArmed = false;
    }

    private void RenderHome()
    {
        ResetPage();
        _currentPage = "home";
        PageTitleText.Text = "Banxuebang Homework";
        PageSubtitleText.Text = "登录状态、当前学期和应用数据路径。";
        HomePanel.Visibility = Visibility.Visible;
        ListTitleText.Text = "会话";
        PrimaryActionButton.Content = "刷新会话";
        SecondaryActionButton.Content = "打开数据目录";
        SecondaryActionButton.Visibility = Visibility.Visible;
        SetHomeSessionBlocks(_session);
    }

    private void RenderAgent()
    {
        ResetPage();
        _currentPage = "agent";
        PageHeaderPanel.Visibility = Visibility.Collapsed;
        ToolbarCard.Visibility = Visibility.Collapsed;
        AgentPanel.Visibility = Visibility.Visible;
        if (string.IsNullOrWhiteSpace(_activeConversationId))
        {
            AgentConversationTitleText.Text = "新对话";
        }
        AgentModelText.Text = "正在读取模型配置";
        UpdateAgentConversationPaneVisibility();
        UpdateAgentSendButtonState();
        RenderAgentMessages(_agentPreviewMessages);
        SetAgentStepsMessage("点击助手消息下方的“查看过程”。");
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
        ThirdActionButton.Content = "重命名";
        ThirdActionButton.Visibility = Visibility.Visible;
        ThirdActionButton.IsEnabled = false;
        DangerActionButton.Content = "删除文件";
        DangerActionButton.Visibility = Visibility.Visible;
        DangerActionButton.IsEnabled = false;
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
            ("all", "全部"),
            ("pending_review", "待审核"),
            ("approved", "已通过"),
            ("rejected", "已驳回"),
            ("submitted", "已提交"),
            ("sent_to_teacher", "已私信老师"));
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
        ToolbarCard.Visibility = Visibility.Collapsed;
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
            UpdateHomeCredentialStatus();
            HomeTermComboBox.Items.Clear();
            HomeTermComboBox.PlaceholderText = "未读取到学期";
            return;
        }

        var value = session.Value;
        var ready = GetString(value, "ready", "false") == "true" ? "已登录" : "未登录";
        var user = GetString(value, "user.name", "未知用户");
        var className = GetString(value, "currentClass.name", "未知班级");
        var subject = GetString(value, "currentSubject.name", "未知课程");
        var term = CurrentTermLabel(value);
        var pending = GetString(value, "currentSubject.unSubmitCount", "0");
        HomeSessionStatusText.Text = ready;
        HomeUserText.Text = user;
        HomeScopeText.Text = $"{className} · {subject}";
        HomePendingTaskText.Text = pending;
        HomeTermText.Text = string.IsNullOrWhiteSpace(term) ? "未知学期" : term;
        UpdateHomeCredentialStatus();
        PopulateHomeTermCombo(value);
    }

    private void PopulateHomeTermCombo(JsonElement session)
    {
        var currentTermId = GetString(session, "currentTermId", "");
        _suppressComboEvents = true;
        HomeTermComboBox.Items.Clear();

        if (session.TryGetProperty("availableTerms", out var terms) && terms.ValueKind == JsonValueKind.Array)
        {
            foreach (var term in terms.EnumerateArray())
            {
                var id = GetString(term, "id", "");
                var name = FirstString(term, "name", "termName", "id");
                if (string.IsNullOrWhiteSpace(id) && string.IsNullOrWhiteSpace(name)) continue;
                HomeTermComboBox.Items.Add(new ComboItem
                {
                    Key = string.IsNullOrWhiteSpace(id) ? name : id,
                    Label = string.IsNullOrWhiteSpace(name) ? id : name,
                    Data = term.Clone(),
                });
            }
        }

        HomeTermComboBox.PlaceholderText = HomeTermComboBox.Items.Count == 0 ? "未读取到学期" : "选择学期";
        HomeTermComboBox.IsEnabled = HomeTermComboBox.Items.Count > 0;
        for (var index = 0; index < HomeTermComboBox.Items.Count; index += 1)
        {
            if ((HomeTermComboBox.Items[index] as ComboItem)?.Key == currentTermId)
            {
                HomeTermComboBox.SelectedIndex = index;
                break;
            }
        }
        if (HomeTermComboBox.SelectedIndex < 0 && HomeTermComboBox.Items.Count > 0)
        {
            HomeTermComboBox.SelectedIndex = 0;
        }
        _suppressComboEvents = false;
    }

    private static string CurrentTermLabel(JsonElement session)
    {
        var currentTermId = GetString(session, "currentTermId", "");
        if (session.TryGetProperty("availableTerms", out var terms) && terms.ValueKind == JsonValueKind.Array)
        {
            foreach (var term in terms.EnumerateArray())
            {
                if (GetString(term, "id", "") == currentTermId)
                {
                    return FirstString(term, "name", "termName", "id");
                }
            }
        }

        return FirstString(session, "currentTermName", "currentTermId");
    }

    private async Task LoadConversationsAsync(int loadVersion = 0)
    {
        loadVersion = loadVersion == 0 ? _pageLoadVersion : loadVersion;
        if (!IsCurrentPageLoad("agent", loadVersion)) return;
        if (_agentPreviewMessages.Count == 0)
        {
            SetAgentTranscriptPlain("正在加载对话...");
        }
        var result = await InvokeAsync("agent:conversations:list");
        if (!IsCurrentPageLoad("agent", loadVersion)) return;
        _agentConversationCache.Clear();
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
                _agentConversationCache.Add(item);
            }
        }
        var activeId = GetString(result, "activeId", "");
        ApplyAgentConversationFilter(activeId);
        if (result.TryGetProperty("activeConversation", out var active))
        {
            var loadedConversationId = FirstString(active, "id", "conversationId");
            var preserveRunningPreview = _agentRequestRunning
                && _agentPreviewMessages.Any(message => message.IsRunning)
                && string.Equals(loadedConversationId, _activeConversationId, StringComparison.Ordinal);
            if (!preserveRunningPreview)
            {
                ShowConversation(active);
            }
            else
            {
                AgentConversationTitleText.Text = FirstString(active, "title") is { Length: > 0 } title
                    ? title
                    : AgentConversationTitleText.Text;
                UpdateAgentContextMeter(active);
                RenderAgentMessages(_agentPreviewMessages);
            }
        }
        else if (_agentConversationCache.Count == 0)
        {
            _activeConversationId = "";
            AgentConversationTitleText.Text = "新对话";
            SetAgentTranscriptPlain("");
        }
    }

    private async Task LoadAgentModelSummaryAsync(int loadVersion)
    {
        if (!IsCurrentPageLoad("agent", loadVersion)) return;
        var config = await InvokeAsync("config:model:load");
        if (!IsCurrentPageLoad("agent", loadVersion)) return;

        var activeProviderId = GetSettingsProviderIdForRole(config, "chat");
        JsonElement? activeProvider = null;
        if (TryGetSettingsProviderArray(config, "chat", out var providers))
        {
            foreach (var provider in providers.EnumerateArray())
            {
                if (FirstString(provider, "id", "providerId") == activeProviderId)
                {
                    activeProvider = provider.Clone();
                    break;
                }
            }
        }

        var providerName = activeProvider.HasValue
            ? FirstString(activeProvider.Value, "name", "providerName", "id")
            : GetString(config, "providerName", "默认提供商");
        var modelName = activeProvider.HasValue
            ? FirstString(activeProvider.Value, "modelName", "model")
            : GetString(config, "modelName", "");
        AgentModelText.Text = string.IsNullOrWhiteSpace(modelName) ? providerName : $"{providerName} · {modelName}";
    }

    private void ApplyAgentConversationFilter(string? selectedId = null)
    {
        var query = AgentConversationSearchBox.Text.Trim();
        var targetId = selectedId ?? _activeConversationId;
        _suppressAgentConversationEvents = true;
        try
        {
            _agentConversationItems.Clear();
            foreach (var item in _agentConversationCache)
            {
                if (query.Length == 0
                    || item.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                    || item.Subtitle.Contains(query, StringComparison.CurrentCultureIgnoreCase))
                {
                    _agentConversationItems.Add(item);
                }
            }

            AgentConversationListView.SelectedItem = _agentConversationItems.FirstOrDefault(item => item.Id == targetId);
        }
        finally
        {
            _suppressAgentConversationEvents = false;
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
        SetDetail(_items.Count == 0 ? "当前筛选下暂无草稿。" : "选择左侧草稿查看和编辑。");
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
        _ = LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "all");
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
        _settingsConfig = config.Clone();
        _settingsDefaultCustomInstructions = GetString(config, "defaultCustomInstructions", "");
        PopulateSettingsProviderTypes();
        PopulateSettingsProviders(config);

        var provider = GetCurrentSettingsProviderElement();
        _suppressSettingsImageCaptionEnabled = true;
        try
        {
            SettingsImageCaptionEnabledCheckBox.Visibility = _settingsModelRole == "image_caption" ? Visibility.Visible : Visibility.Collapsed;
            SettingsImageCaptionEnabledCheckBox.IsChecked = _settingsModelRole != "image_caption" || GetSettingsModelRoleEnabled(config, _settingsModelRole);
        }
        finally
        {
            _suppressSettingsImageCaptionEnabled = false;
        }

        _settingsHasApiKey = provider.HasValue
            && (GetString(provider, "hasApiKey", "false") == "true" || !string.IsNullOrWhiteSpace(GetString(provider, "apiKeyMasked", "")));
        SettingsProviderDetailsPanel.Visibility = provider.HasValue ? Visibility.Visible : Visibility.Collapsed;
        SettingsProviderEmptyText.Visibility = provider.HasValue ? Visibility.Collapsed : Visibility.Visible;

        SettingsApiKeyBox.Password = "";
        SettingsApiKeyBox.PlaceholderText = _settingsHasApiKey
            ? $"已保存：{GetString(provider, "apiKeyMasked", "******")}，留空则保留"
            : "请输入 API Key";
        SettingsProviderNameBox.Text = provider.HasValue ? FirstString(provider.Value, "name", "providerName") : "";
        SettingsBaseUrlBox.Text = GetString(provider, "baseUrl", "");
        SettingsModelNameBox.Text = GetString(provider, "modelName", "");
        var providerTitle = string.IsNullOrWhiteSpace(SettingsProviderNameBox.Text) ? "模型配置" : SettingsProviderNameBox.Text;
        SettingsProviderTitleText.Text = $"{CurrentSettingsModelRoleLabel()} · {providerTitle}";
        SettingsProviderEndpointText.Text = provider.HasValue ? FormatProviderSubtitle(provider.Value) : "尚未配置提供商";
        SettingsModelNameBox.Visibility = Visibility.Visible;
        SettingsModelComboBox.Visibility = Visibility.Collapsed;
        SettingsModelComboBox.Items.Clear();
        SettingsContextLengthBox.Text = GetString(config, "contextLength", "");
        SettingsChatTemperatureBox.Text = GetString(config, "chatTemperature", "0.2");
        SettingsCompactTemperatureBox.Text = GetString(config, "compactTemperature", "0.1");
        SettingsMaxToolRoundsBox.Text = GetString(config, "maxToolRounds", "6");
        SettingsLongPasteThresholdBox.Text = GetString(config, "longPasteThreshold", "4000");
        SettingsCustomInstructionsBox.Text = GetString(config, "customInstructions", "");
        SelectSettingsTheme(GetString(config, "theme", "light"));
        SettingsModelStatusText.Text = _settingsHasApiKey ? "API Key 已保存。留空保存不会覆盖已保存 Key。" : "API Key 未配置。";

        if (SettingsModelComboBox.Visibility == Visibility.Visible)
        {
            SelectSettingsModel(GetCurrentSettingsModelName());
        }
    }

    private void PopulateSettingsProviderTypes()
    {
        if (SettingsProviderTypeComboBox.Items.Count > 0) return;
        _suppressSettingsProviderTypeCombo = true;
        try
        {
            SettingsProviderTypeComboBox.Items.Clear();
            foreach (var preset in ModelProviderPresets)
            {
                SettingsProviderTypeComboBox.Items.Add(new ComboBoxItem { Content = preset.Name, Tag = preset });
            }
            SettingsProviderTypeComboBox.SelectedIndex = 0;
            ApplyNewProviderPreset(ModelProviderPresets[0]);
        }
        finally
        {
            _suppressSettingsProviderTypeCombo = false;
        }
    }

    private void ApplyNewProviderPreset(ModelProviderPreset preset)
    {
        SettingsNewProviderNameBox.Text = preset.Name;
        SettingsNewProviderBaseUrlBox.Text = preset.BaseUrl;
        SettingsNewProviderModelNameBox.Text = preset.ModelName;
    }

    private void PopulateSettingsProviders(JsonElement config)
    {
        _suppressSettingsProviderCombo = true;
        try
        {
            _settingsProviderItems.Clear();
            SettingsProviderListView.SelectedIndex = -1;
            var activeProviderId = GetSettingsProviderIdForRole(config, _settingsModelRole);
            if (TryGetSettingsProviderArray(config, _settingsModelRole, out var providers))
            {
                foreach (var provider in providers.EnumerateArray())
                {
                    var id = FirstString(provider, "id", "providerId");
                    if (string.IsNullOrWhiteSpace(id)) continue;
                    var label = FirstString(provider, "name", "label", "providerName", "modelName", "baseUrl", "id");
                    _settingsProviderItems.Add(new DisplayItem
                    {
                        Id = id,
                        Title = label,
                        Subtitle = FormatProviderSubtitle(provider),
                        Data = provider.Clone(),
                    });
                }
            }

            if (_settingsProviderItems.Count == 0 && _settingsModelRole == "chat")
            {
                _settingsProviderItems.Add(new DisplayItem
                {
                    Id = GetString(config, "activeProviderId", "default"),
                    Title = GetString(config, "providerName", "默认提供商"),
                    Subtitle = FormatProviderSubtitle(config),
                    Data = config.Clone(),
                });
            }

            for (var index = 0; index < _settingsProviderItems.Count; index += 1)
            {
                if (_settingsProviderItems[index].Id == activeProviderId)
                {
                    SettingsProviderListView.SelectedIndex = index;
                    return;
                }
            }

            SettingsProviderListView.SelectedIndex = 0;
        }
        finally
        {
            _suppressSettingsProviderCombo = false;
        }
    }

    private static bool TryGetSettingsProviderArray(JsonElement config, string role, out JsonElement providers)
    {
        providers = default;
        if (config.TryGetProperty("modelRoles", out var roles)
            && roles.ValueKind == JsonValueKind.Object
            && roles.TryGetProperty(NormalizeSettingsModelRole(role), out var roleConfig)
            && roleConfig.ValueKind == JsonValueKind.Object
            && roleConfig.TryGetProperty("providers", out providers)
            && providers.ValueKind == JsonValueKind.Array)
        {
            return true;
        }

        return NormalizeSettingsModelRole(role) == "chat"
            && config.TryGetProperty("providers", out providers)
            && providers.ValueKind == JsonValueKind.Array;
    }

    private static string FormatProviderSubtitle(JsonElement provider)
    {
        var type = FirstString(provider, "type", "providerType");
        var baseUrl = FirstString(provider, "baseUrl", "apiBaseUrl", "endpoint");
        var modelName = FirstString(provider, "modelName", "model");
        return string.Join(" · ", new[] { type, baseUrl, modelName }.Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private string GetSettingsProviderIdForRole(JsonElement config, string role)
    {
        var normalizedRole = NormalizeSettingsModelRole(role);
        if (config.TryGetProperty("modelRoles", out var roles)
            && roles.ValueKind == JsonValueKind.Object
            && roles.TryGetProperty(normalizedRole, out var roleConfig)
            && roleConfig.ValueKind == JsonValueKind.Object)
        {
            var roleProviderId = FirstString(roleConfig, "activeProviderId", "providerId");
            if (!string.IsNullOrWhiteSpace(roleProviderId))
            {
                return roleProviderId;
            }
        }

        return normalizedRole == "chat" ? GetString(config, "activeProviderId", "default") : "";
    }

    private static bool GetSettingsModelRoleEnabled(JsonElement config, string role)
    {
        var normalizedRole = NormalizeSettingsModelRole(role);
        if (config.TryGetProperty("modelRoles", out var roles)
            && roles.ValueKind == JsonValueKind.Object
            && roles.TryGetProperty(normalizedRole, out var roleConfig)
            && roleConfig.ValueKind == JsonValueKind.Object)
        {
            return GetString(roleConfig, "enabled", "false") == "true";
        }

        return normalizedRole == "chat";
    }

    private static string NormalizeSettingsModelRole(string role)
    {
        return string.Equals(role, "image_caption", StringComparison.OrdinalIgnoreCase) ? "image_caption" : "chat";
    }

    private string CurrentSettingsModelRoleLabel()
    {
        return _settingsModelRole == "image_caption" ? "图片转述" : "对话";
    }

    private JsonElement? GetCurrentSettingsProviderElement()
    {
        return SettingsProviderListView.SelectedItem is DisplayItem item ? item.Data : null;
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
        var config = new Dictionary<string, object>
        {
            ["modelRole"] = _settingsModelRole,
            ["enabled"] = _settingsModelRole != "image_caption" || SettingsImageCaptionEnabledCheckBox.IsChecked == true,
            ["contextLength"] = SettingsContextLengthBox.Text.Trim(),
            ["chatTemperature"] = SettingsChatTemperatureBox.Text.Trim(),
            ["compactTemperature"] = SettingsCompactTemperatureBox.Text.Trim(),
            ["maxToolRounds"] = SettingsMaxToolRoundsBox.Text.Trim(),
            ["longPasteThreshold"] = SettingsLongPasteThresholdBox.Text.Trim(),
            ["customInstructions"] = SettingsCustomInstructionsBox.Text.Trim(),
            ["theme"] = GetCurrentSettingsTheme(),
        };

        if (SettingsProviderListView.SelectedItem is DisplayItem)
        {
            var modelName = GetCurrentSettingsModelName();
            var providerId = GetCurrentSettingsProviderId();
            var providerName = SettingsProviderNameBox.Text.Trim();
            if (string.IsNullOrWhiteSpace(providerName)) providerName = "默认提供商";
            var provider = new Dictionary<string, object>
            {
                ["id"] = providerId,
                ["type"] = GetCurrentSettingsProviderType(),
                ["name"] = providerName,
                ["baseUrl"] = SettingsBaseUrlBox.Text.Trim(),
                ["modelName"] = modelName,
            };
            config["activeProviderId"] = providerId;
            config["providerName"] = providerName;
            config["provider"] = provider;
            config["baseUrl"] = SettingsBaseUrlBox.Text.Trim();
            config["modelName"] = modelName;

            if (!string.IsNullOrWhiteSpace(SettingsApiKeyBox.Password))
            {
                var apiKey = SettingsApiKeyBox.Password.Trim();
                provider["apiKey"] = apiKey;
                config["apiKey"] = apiKey;
            }
        }

        return config;
    }

    private string GetCurrentSettingsProviderId()
    {
        if (SettingsProviderListView.SelectedItem is DisplayItem item && !string.IsNullOrWhiteSpace(item.Id))
        {
            return item.Id;
        }

        return _settingsConfig.HasValue ? GetSettingsProviderIdForRole(_settingsConfig.Value, _settingsModelRole) : "default";
    }

    private string GetCurrentSettingsProviderType()
    {
        return GetString(GetCurrentSettingsProviderElement(), "type", "openai");
    }

    private string GetCurrentSettingsModelName()
    {
        if (SettingsModelComboBox.Visibility == Visibility.Visible && SettingsModelComboBox.SelectedItem is ComboBoxItem item)
        {
            return (item.Tag?.ToString() ?? item.Content?.ToString() ?? "").Trim();
        }

        return SettingsModelNameBox.Text.Trim();
    }

    private string GetCurrentSettingsTheme()
    {
        if (SettingsThemeComboBox.SelectedItem is ComboBoxItem item)
        {
            var value = (item.Tag?.ToString() ?? item.Content?.ToString() ?? "").Trim().ToLowerInvariant();
            return value == "dark" ? "dark" : "light";
        }

        return "light";
    }

    private void SelectSettingsTheme(string theme)
    {
        var normalized = string.Equals(theme, "dark", StringComparison.OrdinalIgnoreCase) ? "dark" : "light";
        _suppressSettingsThemeCombo = true;
        try
        {
            foreach (var item in SettingsThemeComboBox.Items.OfType<ComboBoxItem>())
            {
                if (string.Equals(item.Tag?.ToString(), normalized, StringComparison.OrdinalIgnoreCase))
                {
                    SettingsThemeComboBox.SelectedItem = item;
                    break;
                }
            }
        }
        finally
        {
            _suppressSettingsThemeCombo = false;
        }
        ApplyTheme(normalized);
    }

    private void ApplyTheme(string theme)
    {
        RootGrid.RequestedTheme = string.Equals(theme, "dark", StringComparison.OrdinalIgnoreCase)
            ? ElementTheme.Dark
            : ElementTheme.Light;
        if (AgentPanel.Visibility == Visibility.Visible)
        {
            RenderAgentMessages(_agentPreviewMessages);
        }
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
            ("modelConfigPath", "模型配置文件", "保存 API Key、调用链接、模型名、Temperature 和 Agent 自定义指令。", GetString(appInfo, "modelConfigPath", "")),
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
                    await LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "all");
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
                    await InvokeAsync("app:open-path", new { key = "dataRoot" });
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
                case "workspace":
                    await RenameWorkspaceFileAsync();
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
            else if (_currentPage == "workspace")
            {
                await DeleteWorkspaceFileAsync();
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

    private async void OnAgentConversationSelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_suppressAgentConversationEvents || _currentPage != "agent") return;
        if (AgentConversationListView.SelectedItem is not DisplayItem item || item.Id == _activeConversationId) return;
        await RunUiAsync(async () =>
        {
            _agentShouldFollowLatest = true;
            _agentScrollTop = 0;
            AgentStepsDrawer.Visibility = Visibility.Collapsed;
            var selected = await InvokeAsync("agent:conversations:select", new { conversationId = item.Id });
            if (selected.TryGetProperty("activeConversation", out var active)) ShowConversation(active);
            FocusAgentInput();
        });
    }

    private void OnAgentConversationSearchTextChanged(object sender, TextChangedEventArgs args)
    {
        ApplyAgentConversationFilter();
    }

    private void OnAgentConversationPaneToggleClick(object sender, RoutedEventArgs args)
    {
        var isVisible = AgentConversationPane.Visibility == Visibility.Visible;
        _agentConversationPaneCollapsed = isVisible;
        if (!isVisible)
        {
            _agentConversationPaneAutoCollapsed = false;
        }
        UpdateAgentConversationPaneVisibility();
    }

    private void OnAgentPanelSizeChanged(object sender, SizeChangedEventArgs args)
    {
        _agentConversationPaneAutoCollapsed = args.NewSize.Width < 820;
        UpdateAgentConversationPaneVisibility();
        if (args.NewSize.Width < 760 && AgentStepsDrawer.Visibility == Visibility.Visible)
        {
            AgentStepsDrawer.Width = Math.Max(300, args.NewSize.Width - 24);
        }
        else
        {
            AgentStepsDrawer.Width = 370;
        }
    }

    private void UpdateAgentConversationPaneVisibility()
    {
        var collapsed = _agentConversationPaneCollapsed || _agentConversationPaneAutoCollapsed;
        AgentConversationColumn.Width = collapsed ? new GridLength(0) : new GridLength(260);
        AgentConversationPane.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
    }

    private void OnAgentStepsDrawerCloseClick(object sender, RoutedEventArgs args)
    {
        AgentStepsDrawer.Visibility = Visibility.Collapsed;
    }

    private async void OnAgentNewConversationClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            _deleteConversationArmed = false;
            await InvokeAsync("agent:conversations:create", new { title = "新对话" });
            AgentInputBox.Text = "";
            AgentStepsDrawer.Visibility = Visibility.Collapsed;
            _agentShouldFollowLatest = true;
            _agentScrollTop = 0;
            await LoadConversationsAsync();
            FocusAgentInput();
        });
    }

    private async void OnAgentRenameConversationClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            var conversationId = ConversationIdFromSender(sender);
            var item = _agentConversationCache.FirstOrDefault(candidate => candidate.Id == conversationId);
            if (item is null) return;
            var nextTitle = await PromptConversationTitleAsync(item.Title);
            if (nextTitle is null) return;
            await InvokeAsync("agent:conversations:rename", new { conversationId = item.Id, title = nextTitle });
            SetStatus("对话已重命名");
            await LoadConversationsAsync();
        });
    }

    private async void OnAgentDeleteConversationClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            var conversationId = ConversationIdFromSender(sender);
            var item = _agentConversationCache.FirstOrDefault(candidate => candidate.Id == conversationId);
            if (item is null || !await ConfirmConversationDeleteAsync(item.Title)) return;
            await InvokeAsync("agent:conversations:delete", new { conversationId = item.Id });
            AgentStepsDrawer.Visibility = Visibility.Collapsed;
            SetStatus("对话已删除");
            await LoadConversationsAsync();
            FocusAgentInput();
        });
    }

    private string ConversationIdFromSender(object sender)
    {
        return (sender as FrameworkElement)?.Tag?.ToString() ?? _activeConversationId;
    }

    private async Task<bool> ConfirmConversationDeleteAsync(string title)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = RootNavigation.XamlRoot,
            Title = "删除对话",
            Content = $"确定删除“{title}”吗？此操作无法撤销。",
            PrimaryButtonText = "删除",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
        };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }

    private async Task<string?> PromptConversationTitleAsync(string currentTitle)
    {
        var input = new TextBox
        {
            Text = currentTitle,
            MaxLength = 80,
            PlaceholderText = "输入新的对话名称",
        };
        input.Loaded += (_, _) =>
        {
            input.Focus(FocusState.Programmatic);
            input.SelectAll();
        };

        var dialog = new ContentDialog
        {
            XamlRoot = RootNavigation.XamlRoot,
            Title = "重命名对话",
            Content = input,
            PrimaryButtonText = "保存",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary) return null;
        var title = input.Text.Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            SetStatus("对话名称不能为空");
            return null;
        }
        return title;
    }

    private async void OnAgentCompactClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            SetAgentStepsMessage("正在压缩上下文...");
            var result = await InvokeAsync("agent:compact", new { conversationId = _activeConversationId });
            var changed = GetString(result, "changed", "false") == "true";
            var before = GetString(result, "beforeTokens", "");
            var after = GetString(result, "afterTokens", "");
            SetAgentStepsMessage(changed && !string.IsNullOrWhiteSpace(before) && !string.IsNullOrWhiteSpace(after)
                ? $"上下文已压缩：{before} -> {after} tokens。"
                : GetString(result, "summary", "近期上下文较少，暂时无需压缩。"));
            SetStatus(changed ? "上下文压缩完成" : "当前没有可压缩的旧对话");
            await LoadConversationsAsync();
        });
    }

    private async void OnAgentSendClick(object sender, RoutedEventArgs args)
    {
        if (_agentRequestRunning)
        {
            await RunUiAsync(StopAgentAsync);
            return;
        }
        await RunUiAsync(SendAgentAsync);
    }

    private async Task StopAgentAsync()
    {
        if (!_agentRequestRunning || _agentStopRequested) return;
        _agentStopRequested = true;
        UpdateAgentSendButtonState();
        SetStatus("正在停止生成...");
        try
        {
            var result = await InvokeAsync("agent:cancel", new
            {
                conversationId = _activeConversationId,
                assistantMessageId = _runningAgentMessageId,
            });
            if (GetString(result, "cancellationRequested", "false") != "true")
            {
                _agentStopRequested = false;
                UpdateAgentSendButtonState();
                SetStatus("当前请求已经结束");
            }
        }
        catch
        {
            _agentStopRequested = false;
            UpdateAgentSendButtonState();
            throw;
        }
    }

    private async void OnAgentInputKeyDown(object sender, KeyRoutedEventArgs args)
    {
        if (args.Key != VirtualKey.Enter) return;
        var controlState = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Control);
        if ((controlState & CoreVirtualKeyStates.Down) == CoreVirtualKeyStates.Down)
        {
            var selectionStart = AgentInputBox.SelectionStart;
            var selectionLength = AgentInputBox.SelectionLength;
            AgentInputBox.Text = AgentInputBox.Text
                .Remove(selectionStart, selectionLength)
                .Insert(selectionStart, Environment.NewLine);
            AgentInputBox.SelectionStart = selectionStart + Environment.NewLine.Length;
            AgentInputBox.SelectionLength = 0;
            args.Handled = true;
            return;
        }
        args.Handled = true;
        await RunUiAsync(SendAgentAsync);
    }

    private async void OnAgentInputPaste(object sender, TextControlPasteEventArgs args)
    {
        if (_agentRequestRunning) return;
        var clipboard = Clipboard.GetContent();
        var hasBitmap = clipboard.Contains(StandardDataFormats.Bitmap);
        var hasStorageItems = clipboard.Contains(StandardDataFormats.StorageItems);
        if (!hasBitmap && !hasStorageItems) return;

        args.Handled = true;
        await RunUiAsync(async () =>
        {
            var remaining = MaxAgentInputImages - _agentComposerFiles.Count;
            if (remaining <= 0) throw new InvalidOperationException($"每条消息最多附带 {MaxAgentInputImages} 张图片。");
            var payloads = new List<Dictionary<string, object>>();
            if (hasStorageItems)
            {
                var items = await clipboard.GetStorageItemsAsync();
                foreach (var file in items.OfType<StorageFile>())
                {
                    if (payloads.Count >= remaining) break;
                    var mimeType = NormalizeClipboardImageType(file.ContentType, file.FileType);
                    if (!SupportedClipboardImageTypes.Contains(mimeType)) continue;
                    var properties = await file.GetBasicPropertiesAsync();
                    if ((long)properties.Size > MaxAgentInputImageBytes)
                    {
                        throw new InvalidOperationException($"图片“{file.Name}”超过 25 MB。");
                    }
                    var buffer = await FileIO.ReadBufferAsync(file);
                    payloads.Add(new Dictionary<string, object>
                    {
                        ["kind"] = "image",
                        ["name"] = file.Name,
                        ["mimeType"] = mimeType,
                        ["base64"] = Convert.ToBase64String(buffer.ToArray()),
                    });
                }
            }

            if (payloads.Count == 0 && hasBitmap)
            {
                var reference = await clipboard.GetBitmapAsync();
                using var stream = await reference.OpenReadAsync();
                if ((long)stream.Size > MaxAgentInputImageBytes) throw new InvalidOperationException("粘贴图片超过 25 MB。");
                var mimeType = NormalizeClipboardImageType(stream.ContentType, ".png");
                var bytes = await ReadClipboardStreamAsync(stream);
                payloads.Add(new Dictionary<string, object>
                {
                    ["kind"] = "image",
                    ["name"] = $"pasted-image-{DateTime.Now:yyyyMMdd-HHmmss}.png",
                    ["mimeType"] = mimeType,
                    ["base64"] = Convert.ToBase64String(bytes),
                });
            }

            if (payloads.Count == 0)
            {
                SetStatus("剪贴板中没有支持的图片");
                return;
            }

            var result = await InvokeAsync("workspace:save-pastes", new { items = payloads });
            if (result.TryGetProperty("saved", out var saved) && saved.ValueKind == JsonValueKind.Array)
            {
                foreach (var file in saved.EnumerateArray())
                {
                    var path = GetString(file, "path", "");
                    _agentComposerFiles.Add(new DisplayItem
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        Title = GetString(file, "name", "粘贴图片"),
                        Subtitle = GetString(file, "relativePath", path),
                        Path = path,
                        Data = file.Clone(),
                    });
                }
            }
            UpdateAgentComposerFilesVisibility();
            SetStatus($"已将 {payloads.Count} 张图片保存到工作区");
            FocusAgentInput();
        });
    }

    private static async Task<byte[]> ReadClipboardStreamAsync(IRandomAccessStreamWithContentType stream)
    {
        using var reader = new DataReader(stream.GetInputStreamAt(0));
        var length = checked((uint)stream.Size);
        await reader.LoadAsync(length);
        var bytes = new byte[(int)length];
        reader.ReadBytes(bytes);
        return bytes;
    }

    private static string NormalizeClipboardImageType(string? contentType, string? extension)
    {
        if (!string.IsNullOrWhiteSpace(contentType) && SupportedClipboardImageTypes.Contains(contentType)) return contentType.ToLowerInvariant();
        return (extension ?? "").ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".bmp" => "image/bmp",
            ".avif" => "image/avif",
            _ => "image/png",
        };
    }

    private void OnAgentComposerFileRemoveClick(object sender, RoutedEventArgs args)
    {
        if (sender is Button { DataContext: DisplayItem item }) _agentComposerFiles.Remove(item);
        UpdateAgentComposerFilesVisibility();
        FocusAgentInput();
    }

    private void UpdateAgentComposerFilesVisibility()
    {
        AgentComposerFilesListView.Visibility = _agentComposerFiles.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void FocusAgentInput()
    {
        DispatcherQueue.TryEnqueue(() => AgentInputBox.Focus(FocusState.Programmatic));
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
            await RunUiAsync(() => LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "all"));
        }
    }

    private async void OnMainListSelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_currentPage == "workspace")
        {
            var hasWorkspaceFile = MainListView.SelectedItem is DisplayItem selected && !IsStateItem(selected);
            ThirdActionButton.IsEnabled = hasWorkspaceFile;
            DangerActionButton.IsEnabled = hasWorkspaceFile;
        }
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
                    ShowHomeworkDetail(detail);
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
        if (_agentRequestRunning) return;
        var text = AgentInputBox.Text.Trim();
        var attachedImages = _agentComposerFiles.ToList();
        if (string.IsNullOrWhiteSpace(text) && attachedImages.Count == 0) return;
        if (text == "/compact" && attachedImages.Count == 0)
        {
            var compactResult = await InvokeAsync("agent:compact", new { conversationId = _activeConversationId });
            AgentInputBox.Text = "";
            SetAgentStepsMessage(GetString(compactResult, "summary", "上下文处理完成。"));
            await LoadConversationsAsync();
            FocusAgentInput();
            return;
        }

        var userMessageId = NewAgentMessageId();
        var assistantMessageId = NewAgentMessageId();
        _agentRequestRunning = true;
        _agentStopRequested = false;
        _runningAgentMessageId = assistantMessageId;
        UpdateAgentSendButtonState();
        AgentInputBox.Text = "";
        _agentComposerFiles.Clear();
        UpdateAgentComposerFilesVisibility();
        _selectedAgentMessageId = assistantMessageId;
        _agentShouldFollowLatest = true;
        var previewText = string.Join("\n", new[] { text }
            .Concat(attachedImages.Select(file => $"[图片] {file.Title}"))
            .Where(value => !string.IsNullOrWhiteSpace(value)));
        _agentPreviewMessages.Add(new AgentChatMessage(userMessageId, "user", previewText));
        _agentPreviewMessages.Add(new AgentChatMessage(assistantMessageId, "assistant", "", null, true));
        RenderAgentMessages(_agentPreviewMessages);
        SetAgentStepsMessage("正在请求模型...");
        try
        {
            var result = await InvokeAsync("agent:chat", new
            {
                text,
                attachments = attachedImages.Select(file => new
                {
                    path = file.Path,
                    relativePath = GetString(file.Data, "relativePath", ""),
                    name = file.Title,
                    mimeType = GetString(file.Data, "mimeType", ""),
                }).ToArray(),
                conversationId = _activeConversationId,
                userMessageId,
                assistantMessageId,
            });
            var finalSteps = result.TryGetProperty("steps", out var resultSteps) ? resultSteps.Clone() : (JsonElement?)null;
            ReplaceAgentMessage(assistantMessageId, GetString(result, "message", "执行完成。"), finalSteps, false);
            RenderAgentMessages(_agentPreviewMessages);
            if (AgentStepsDrawer.Visibility == Visibility.Visible) ShowSelectedAgentSteps();
            await LoadConversationsAsync();
            if (AgentStepsDrawer.Visibility == Visibility.Visible) ShowSelectedAgentSteps();
        }
        catch (Exception error)
        {
            ReplaceAgentMessage(assistantMessageId, $"执行失败：{CleanErrorMessage(error.Message)}", null, false);
            RenderAgentMessages(_agentPreviewMessages);
            throw;
        }
        finally
        {
            _agentRequestRunning = false;
            _agentStopRequested = false;
            _runningAgentMessageId = "";
            UpdateAgentSendButtonState();
            if (_currentPage == "agent") FocusAgentInput();
        }
    }

    private void UpdateAgentSendButtonState()
    {
        AgentSendIcon.Glyph = _agentRequestRunning ? "\uE71A" : "\uE724";
        AgentSendButton.IsEnabled = !_agentStopRequested;
        ToolTipService.SetToolTip(AgentSendButton, _agentRequestRunning
            ? (_agentStopRequested ? "正在停止" : "停止生成")
            : "发送");
    }

    private async Task OpenWorkspaceItemAsync(DisplayItem item)
    {
        var category = GetString(item.Data, "category", "");
        var extension = GetString(item.Data, "extension", "").ToLowerInvariant();
        var isImage = category == "image" || new[] { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif" }.Contains(extension);
        var isPdf = category == "pdf" || extension == ".pdf";
        var isDocx = category == "docx" || extension == ".docx";
        if (isImage)
        {
            var image = await InvokeAsync("workspace:image-data-url", new { filePath = GetString(item.Data, "path", "") });
            await SetDetailImageAsync(image, item.Title);
            return;
        }
        if (isPdf || isDocx)
        {
            await SetDetailDocumentAsync(GetString(item.Data, "path", ""), item.Title);
            return;
        }
        var result = await ToolAsync("read_workspace_file", new { file = GetString(item.Data, "relativePath", item.Title), max_chars = 8000 });
        SetDetail(FormatWorkspacePreview(result));
    }

    private async Task RenameWorkspaceFileAsync()
    {
        if (MainListView.SelectedItem is not DisplayItem item || IsStateItem(item))
        {
            SetStatus("请先选择要重命名的文件");
            return;
        }

        var newName = await PromptWorkspaceFileNameAsync(item.Title);
        if (newName is null || string.Equals(newName, item.Title, StringComparison.Ordinal)) return;
        var result = await InvokeAsync("workspace:rename", new
        {
            file = GetString(item.Data, "relativePath", item.Id),
            newName,
        });
        var renamed = result.GetProperty("file").Clone();
        SynchronizePendingWorkspaceRename(GetString(result, "oldPath", ""), renamed);
        await LoadWorkspaceFilesAsync();
        var relativePath = GetString(renamed, "relativePath", "");
        MainListView.SelectedItem = _items.FirstOrDefault(candidate => candidate.Id == relativePath);
        SetStatus($"已重命名为：{GetString(renamed, "name", newName)}");
    }

    private async Task DeleteWorkspaceFileAsync()
    {
        if (MainListView.SelectedItem is not DisplayItem item || IsStateItem(item))
        {
            SetStatus("请先选择要删除的文件");
            return;
        }
        if (!await ConfirmWorkspaceFileDeleteAsync(item.Title)) return;

        var path = GetString(item.Data, "path", "");
        await InvokeAsync("workspace:delete", new { file = GetString(item.Data, "relativePath", item.Id) });
        RemovePendingWorkspaceFile(path);
        SetDetail("文件已删除。选择其他文件进行预览。");
        await LoadWorkspaceFilesAsync();
        SetStatus($"已删除文件：{item.Title}");
    }

    private async Task<string?> PromptWorkspaceFileNameAsync(string currentName)
    {
        var input = new TextBox
        {
            Text = currentName,
            MaxLength = 255,
            PlaceholderText = "输入新的文件名",
        };
        input.Loaded += (_, _) =>
        {
            input.Focus(FocusState.Programmatic);
            var extensionLength = Path.GetExtension(currentName).Length;
            input.SelectionStart = 0;
            input.SelectionLength = Math.Max(0, currentName.Length - extensionLength);
        };
        var dialog = new ContentDialog
        {
            XamlRoot = RootNavigation.XamlRoot,
            Title = "重命名文件",
            Content = input,
            PrimaryButtonText = "保存",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return null;
        var name = input.Text.Trim();
        if (!string.IsNullOrWhiteSpace(name)) return name;
        SetStatus("文件名不能为空");
        return null;
    }

    private async Task<bool> ConfirmWorkspaceFileDeleteAsync(string name)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = RootNavigation.XamlRoot,
            Title = "删除文件",
            Content = $"确定永久删除“{name}”吗？此操作无法撤销。",
            PrimaryButtonText = "删除",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
        };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }

    private void SynchronizePendingWorkspaceRename(string oldPath, JsonElement renamed)
    {
        if (string.IsNullOrWhiteSpace(oldPath)) return;
        for (var index = 0; index < _agentComposerFiles.Count; index++)
        {
            if (!string.Equals(_agentComposerFiles[index].Path, oldPath, StringComparison.OrdinalIgnoreCase)) continue;
            _agentComposerFiles[index] = new DisplayItem
            {
                Id = _agentComposerFiles[index].Id,
                Title = GetString(renamed, "name", _agentComposerFiles[index].Title),
                Subtitle = GetString(renamed, "relativePath", _agentComposerFiles[index].Subtitle),
                Path = GetString(renamed, "path", _agentComposerFiles[index].Path),
                Data = renamed.Clone(),
            };
        }
        UpdateAgentComposerFilesVisibility();
    }

    private void RemovePendingWorkspaceFile(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        foreach (var pending in _agentComposerFiles.Where(candidate => string.Equals(candidate.Path, path, StringComparison.OrdinalIgnoreCase)).ToList())
        {
            _agentComposerFiles.Remove(pending);
        }
        UpdateAgentComposerFilesVisibility();
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
        await LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "all");
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
        ResetDeleteProviderArming();
        await RunUiAsync(async () =>
        {
            var config = await InvokeAsync("config:model:save", BuildSettingsConfig());
            ApplySettingsConfig(config);
            SetStatus("设置已保存");
        });
    }

    private async void OnSettingsTestConfigClick(object sender, RoutedEventArgs args)
    {
        ResetDeleteProviderArming();
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
        ResetDeleteProviderArming();
        await RunUiAsync(async () =>
        {
            var config = await InvokeAsync("config:model:clear");
            _settingsProviderItems.Clear();
            SettingsModelNameBox.Visibility = Visibility.Visible;
            SettingsModelComboBox.Visibility = Visibility.Collapsed;
            SettingsModelComboBox.Items.Clear();
            ApplySettingsConfig(config);
            SetStatus("模型配置已清除");
        });
    }

    private void OnSettingsClearCustomInstructionsClick(object sender, RoutedEventArgs args)
    {
        SettingsCustomInstructionsBox.Text = _settingsDefaultCustomInstructions;
        SetStatus("已清空自定义指令，点击保存设置后生效");
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

    private void OnSettingsModelRoleTabSelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (SettingsModelRoleTabView.SelectedItem is not TabViewItem { Tag: string role }) return;
        var normalizedRole = NormalizeSettingsModelRole(role);
        if (_settingsModelRole == normalizedRole) return;
        ResetDeleteProviderArming();
        _settingsModelRole = normalizedRole;
        if (_settingsConfig.HasValue)
        {
            ApplySettingsConfig(_settingsConfig.Value);
        }
        SetStatus($"正在配置{CurrentSettingsModelRoleLabel()}模型");
    }

    private async void OnSettingsProviderSelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_suppressSettingsProviderCombo || SettingsProviderListView.SelectedItem is not DisplayItem item) return;
        ResetDeleteProviderArming();
        await RunUiAsync(async () =>
        {
            var config = await InvokeAsync("config:model:provider:select", new { providerId = item.Id, modelRole = _settingsModelRole });
            ApplySettingsConfig(config);
            SetStatus($"已切换{CurrentSettingsModelRoleLabel()}模型提供商");
        });
    }

    private void OnSettingsAddProviderClick(object sender, RoutedEventArgs args)
    {
        _deleteProviderArmed = false;
        SettingsDeleteProviderButton.Content = "删除提供商";
        var showing = SettingsProviderCreatePanel.Visibility == Visibility.Visible;
        SettingsProviderCreatePanel.Visibility = showing ? Visibility.Collapsed : Visibility.Visible;
        SettingsAddProviderButton.Content = showing ? "+ 新增" : "收起";
        if (!showing)
        {
            PopulateSettingsProviderTypes();
            if (SettingsProviderTypeComboBox.SelectedItem is ComboBoxItem { Tag: ModelProviderPreset preset })
            {
                ApplyNewProviderPreset(preset);
            }
            SettingsNewProviderApiKeyBox.Password = "";
            SettingsNewProviderNameBox.Focus(FocusState.Programmatic);
            SettingsNewProviderNameBox.SelectAll();
        }
    }

    private async void OnSettingsDeleteProviderClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            var providerId = GetCurrentSettingsProviderId();
            var providerName = SettingsProviderNameBox.Text.Trim();
            if (!_deleteProviderArmed)
            {
                _deleteProviderArmed = true;
                SettingsDeleteProviderButton.Content = "确认删除";
                SetStatus($"再次点击确认删除“{(string.IsNullOrWhiteSpace(providerName) ? "当前提供商" : providerName)}”。");
                return;
            }
            var config = await InvokeAsync("config:model:provider:delete", new { providerId, modelRole = _settingsModelRole });
            _deleteProviderArmed = false;
            SettingsDeleteProviderButton.Content = "删除提供商";
            ApplySettingsConfig(config);
            SetStatus("已删除模型提供商");
        });
    }

    private async void OnSettingsSaveNewProviderClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            var provider = BuildNewProviderConfig();
            if (provider is null) return;
            provider["modelRole"] = _settingsModelRole;
            var config = await InvokeAsync("config:model:provider:create", provider);
            SettingsProviderCreatePanel.Visibility = Visibility.Collapsed;
            SettingsAddProviderButton.Content = "+ 新增";
            ApplySettingsConfig(config);
            SetStatus($"已新增模型提供商，并用于{CurrentSettingsModelRoleLabel()}");
        });
    }

    private void OnSettingsCancelNewProviderClick(object sender, RoutedEventArgs args)
    {
        SettingsProviderCreatePanel.Visibility = Visibility.Collapsed;
        SettingsAddProviderButton.Content = "+ 新增";
        SettingsNewProviderApiKeyBox.Password = "";
        SetStatus("已取消新增提供商");
    }

    private void OnSettingsProviderTypeSelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_suppressSettingsProviderTypeCombo) return;
        if (SettingsProviderTypeComboBox.SelectedItem is ComboBoxItem { Tag: ModelProviderPreset preset })
        {
            ApplyNewProviderPreset(preset);
        }
    }

    private void OnSettingsImageCaptionEnabledChanged(object sender, RoutedEventArgs args)
    {
        if (_suppressSettingsImageCaptionEnabled || _settingsModelRole != "image_caption") return;
        SetStatus(SettingsImageCaptionEnabledCheckBox.IsChecked == true ? "图片转述将在保存后启用" : "图片转述将在保存后停用");
    }

    private Dictionary<string, object>? BuildNewProviderConfig()
    {
        var selectedPreset = (SettingsProviderTypeComboBox.SelectedItem as ComboBoxItem)?.Tag as ModelProviderPreset ?? ModelProviderPresets.Last();
        var name = SettingsNewProviderNameBox.Text.Trim();
        var baseUrl = SettingsNewProviderBaseUrlBox.Text.Trim();
        var modelName = SettingsNewProviderModelNameBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            SetStatus("提供商名称不能为空");
            SettingsNewProviderNameBox.Focus(FocusState.Programmatic);
            return null;
        }
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            SetStatus("Base URL 不能为空");
            SettingsNewProviderBaseUrlBox.Focus(FocusState.Programmatic);
            return null;
        }

        var provider = new Dictionary<string, object>
        {
            ["type"] = selectedPreset.Type,
            ["name"] = name,
            ["baseUrl"] = baseUrl,
            ["modelName"] = modelName,
        };
        if (!string.IsNullOrWhiteSpace(SettingsNewProviderApiKeyBox.Password))
        {
            provider["apiKey"] = SettingsNewProviderApiKeyBox.Password.Trim();
        }
        return provider;
    }

    private void ResetDeleteProviderArming()
    {
        if (!_deleteProviderArmed) return;
        _deleteProviderArmed = false;
        SettingsDeleteProviderButton.Content = "删除提供商";
    }

    private async void OnSettingsThemeSelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_suppressSettingsThemeCombo) return;
        var theme = GetCurrentSettingsTheme();
        ApplyTheme(theme);
        SetStatus("正在保存主题...");
        await RunUiAsync(async () =>
        {
            await InvokeAsync("config:model:save", new { theme });
            SetStatus("主题已保存");
        });
    }

    private async void OnHomeTermApplyClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (_currentPage != "home" || HomeTermComboBox.SelectedItem is not ComboItem item) return;
            await ToolAsync("set_current_term", new { term_id = item.Key });
            await RefreshSessionAsync();
            SetStatus($"已切换学期：{item.Label}");
        });
    }

    private async void OnHomeCredentialLoginClick(object sender, RoutedEventArgs args)
    {
        if (_homeLoginRunning) return;

        var username = HomeAccountBox.Text.Trim();
        var password = HomePasswordBox.Password;
        if (string.IsNullOrWhiteSpace(username))
        {
            HomeLoginStatusText.Text = "请输入办学帮账号。";
            HomeAccountBox.Focus(FocusState.Programmatic);
            return;
        }
        if (string.IsNullOrEmpty(password))
        {
            HomeLoginStatusText.Text = "请输入办学帮密码。";
            HomePasswordBox.Focus(FocusState.Programmatic);
            return;
        }
        if (HomeAgreeTermsCheckBox.IsChecked != true)
        {
            HomeLoginStatusText.Text = "登录前需要确认同意办学帮登录页的用户协议和隐私政策。";
            HomeAgreeTermsCheckBox.Focus(FocusState.Programmatic);
            return;
        }

        _homeLoginRunning = true;
        SetHomeLoginControlsEnabled(false);
        HomeLoginStatusText.Text = "正在登录并读取账号信息...";
        SetStatus("正在登录办学帮...");

        try
        {
            var result = await InvokeAsync("session:login", new
            {
                username,
                password,
                agreeTerms = true,
                timeoutMs = 60000,
            });
            if (GetString(result, "ready", "false") != "true")
            {
                throw new InvalidOperationException("登录未完成，请检查账号和密码后重试。");
            }

            await RefreshSessionAsync();
            var credentialMessage = "";
            if (HomeRememberCredentialCheckBox.IsChecked == true)
            {
                try
                {
                    SaveLoginCredential(username, password);
                    credentialMessage = "账号和密码已保存到 Windows 凭据保险库。";
                }
                catch
                {
                    credentialMessage = "登录成功，但账号密码未能保存，请稍后重试。";
                }
            }
            else
            {
                ClearSavedLoginCredentials();
                HomePasswordBox.Password = "";
                credentialMessage = "未保存账号和密码。";
            }

            HomeLoginStatusText.Text = $"登录成功。{credentialMessage}";
            SetStatus("办学帮登录成功");
        }
        catch (Exception error)
        {
            var message = CleanErrorMessage(error.Message);
            HomeLoginStatusText.Text = message;
            SetStatus(message);
        }
        finally
        {
            password = string.Empty;
            _homeLoginRunning = false;
            SetHomeLoginControlsEnabled(true);
        }
    }

    private async void OnHomeClearCredentialClick(object sender, RoutedEventArgs args)
    {
        if (!_homeHasSavedCredential || _homeLoginRunning) return;

        var dialog = new ContentDialog
        {
            XamlRoot = RootNavigation.XamlRoot,
            Title = "清除已保存凭据",
            Content = "确定从 Windows 凭据保险库中移除已保存的办学帮账号和密码吗？当前登录会话不会退出。",
            PrimaryButtonText = "清除",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

        ClearSavedLoginCredentials();
        HomeAccountBox.Text = "";
        HomePasswordBox.Password = "";
        HomeRememberCredentialCheckBox.IsChecked = false;
        HomeLoginStatusText.Text = "已清除保存的账号和密码。";
        SetStatus("已清除办学帮登录凭据");
    }

    private void LoadSavedLoginCredential()
    {
        try
        {
            var vault = new PasswordVault();
            var credentials = vault.FindAllByResource(BanxuebangCredentialResource);
            var credential = credentials.FirstOrDefault();
            if (credential is null)
            {
                UpdateHomeCredentialStatus();
                return;
            }

            credential.RetrievePassword();
            HomeAccountBox.Text = credential.UserName;
            HomePasswordBox.Password = credential.Password;
            HomeRememberCredentialCheckBox.IsChecked = true;
            _homeHasSavedCredential = true;
            HomeLoginStatusText.Text = $"已读取保存的账号：{credential.UserName}";
        }
        catch
        {
            _homeHasSavedCredential = false;
        }

        UpdateHomeCredentialStatus();
    }

    private void SaveLoginCredential(string username, string password)
    {
        ClearSavedLoginCredentials();
        var vault = new PasswordVault();
        vault.Add(new PasswordCredential(BanxuebangCredentialResource, username, password));
        _homeHasSavedCredential = true;
        UpdateHomeCredentialStatus();
    }

    private void ClearSavedLoginCredentials()
    {
        try
        {
            var vault = new PasswordVault();
            foreach (var credential in vault.FindAllByResource(BanxuebangCredentialResource))
            {
                vault.Remove(credential);
            }
        }
        catch
        {
            // PasswordVault throws when the resource has no matching credentials.
        }

        _homeHasSavedCredential = false;
        UpdateHomeCredentialStatus();
    }

    private void UpdateHomeCredentialStatus()
    {
        if (HomeCredentialStatusText is null || HomeClearCredentialButton is null) return;
        HomeCredentialStatusText.Text = _homeHasSavedCredential ? "Windows 凭据保险库" : "未保存";
        HomeClearCredentialButton.IsEnabled = _homeHasSavedCredential && !_homeLoginRunning;
    }

    private void SetHomeLoginControlsEnabled(bool enabled)
    {
        HomeAccountBox.IsEnabled = enabled;
        HomePasswordBox.IsEnabled = enabled;
        HomeRememberCredentialCheckBox.IsEnabled = enabled;
        HomeAgreeTermsCheckBox.IsEnabled = enabled;
        HomeLoginButton.IsEnabled = enabled;
        HomeClearCredentialButton.IsEnabled = enabled && _homeHasSavedCredential;
    }

    private async void OnHomeTermRefreshClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (_currentPage != "home") return;
            await ToolAsync("refresh_context");
            await RefreshSessionAsync();
            SetStatus("学期列表已刷新");
        });
    }

    private async void OnHomeworkAttachmentDownloadClick(object sender, RoutedEventArgs args)
    {
        if ((sender as Button)?.Tag is not AttachmentDownloadRequest request) return;
        await RunUiAsync(async () =>
        {
            await ToolAsync("download_task_attachment", new { task_id = request.TaskId, file_id = request.FileId });
            SetStatus($"已下载附件：{request.FileName}");
            if (_currentPage == "workspace")
            {
                await LoadWorkspaceFilesAsync();
            }
        });
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
        HomeworkDetailScrollViewer.Visibility = Visibility.Collapsed;
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Source = new Uri("about:blank");
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

    private async Task SetDetailDocumentAsync(string filePath, string fallbackTitle)
    {
        var resolvedPath = Path.GetFullPath(filePath);
        if (!File.Exists(resolvedPath))
        {
            throw new FileNotFoundException("预览文件不存在。", resolvedPath);
        }
        var extension = Path.GetExtension(resolvedPath).ToLowerInvariant();
        if (extension is not ".pdf" and not ".docx")
        {
            throw new InvalidOperationException("只能直接预览 .pdf 或 .docx 文件。");
        }

        DetailTitleText.Text = string.IsNullOrWhiteSpace(fallbackTitle) ? Path.GetFileName(resolvedPath) : fallbackTitle;
        DetailTextBox.Visibility = Visibility.Collapsed;
        EditorTextBox.Visibility = Visibility.Collapsed;
        HomeworkDetailScrollViewer.Visibility = Visibility.Collapsed;
        HomeworkDetailStackPanel.Children.Clear();
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        WorkspaceImagePreview.Source = null;
        DetailImageCaption.Text = "";
        DetailDocumentWebView.Visibility = Visibility.Visible;
        await DetailDocumentWebView.EnsureCoreWebView2Async();
        if (extension == ".docx")
        {
            var preview = await InvokeAsync("workspace:docx-preview", new { filePath = resolvedPath });
            DetailTitleText.Text = GetString(preview, "fileName", DetailTitleText.Text);
            DetailDocumentWebView.NavigateToString(GetString(preview, "html", "<p>文档没有可预览内容。</p>"));
            return;
        }

        DetailDocumentWebView.Source = new Uri(resolvedPath);
    }

    private void SetAgentTranscriptPlain(string text)
    {
        _agentPreviewMessages.Clear();
        _selectedAgentMessageId = "";
        RenderAgentMessages(string.IsNullOrWhiteSpace(text)
            ? Array.Empty<AgentChatMessage>()
            : new[] { new AgentChatMessage(NewAgentMessageId(), "assistant", text) });
    }

    private void RenderAgentMessages(IReadOnlyList<AgentChatMessage> messages)
    {
        var snapshot = messages.ToList();
        if (AgentPanel.Visibility == Visibility.Visible && !_agentMarkdownWebViewUnavailable)
        {
            if (_agentMarkdownWebView is null) RenderAgentFallback(snapshot);
            var version = ++_agentMarkdownRenderVersion;
            _ = RenderAgentMarkdownAsync(snapshot, version);
            return;
        }
        RenderAgentFallback(snapshot);
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
            _agentMarkdownWebView.NavigateToString(MarkdownHtmlRenderer.RenderConversation(
                messages.Select(message => (
                    message.Id,
                    message.Role,
                    message.Text,
                    message.IsRunning,
                    message.Steps,
                    ProcessExpanded: _expandedAgentProcessIds.Contains(message.Id))),
                GetCurrentUiTheme(),
                _agentShouldFollowLatest,
                _agentScrollTop,
                version));
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
        webView.WebMessageReceived += (_, args) => OnAgentMarkdownWebMessageReceived(args.WebMessageAsJson);
        AgentMarkdownHost.Children.Insert(0, webView);
        return webView;
    }

    private string GetCurrentUiTheme()
    {
        return RootGrid.RequestedTheme == ElementTheme.Dark ? "dark" : "light";
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

    private async void OnAgentMarkdownWebMessageReceived(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            var type = GetString(root, "type", "");
            if (type == "scroll-state")
            {
                if (root.TryGetProperty("viewVersion", out var viewVersion)
                    && viewVersion.TryGetInt32(out var postedVersion)
                    && postedVersion != _agentMarkdownRenderVersion)
                {
                    return;
                }
                _agentShouldFollowLatest = root.TryGetProperty("nearBottom", out var nearBottom)
                    && nearBottom.ValueKind == JsonValueKind.True;
                if (root.TryGetProperty("scrollTop", out var scrollTop) && scrollTop.TryGetDouble(out var position))
                {
                    _agentScrollTop = position;
                }
                return;
            }
            if (type == "show-process")
            {
                SelectAgentMessage(GetString(root, "id", ""));
                return;
            }
            if (type == "process-state")
            {
                var messageId = GetString(root, "id", "");
                if (string.IsNullOrWhiteSpace(messageId)) return;
                var expanded = root.TryGetProperty("expanded", out var expandedValue)
                    && expandedValue.ValueKind == JsonValueKind.True;
                if (expanded) _expandedAgentProcessIds.Add(messageId);
                else _expandedAgentProcessIds.Remove(messageId);
                return;
            }
            if (type == "copy-message")
            {
                var messageId = GetString(root, "id", "");
                var message = _agentPreviewMessages.FirstOrDefault(item => item.Id == messageId);
                if (message is not null)
                {
                    var package = new DataPackage();
                    package.SetText(message.Text);
                    Clipboard.SetContent(package);
                    SetStatus("消息已复制");
                }
                return;
            }
            if (type == "send-suggestion")
            {
                AgentInputBox.Text = GetString(root, "text", "");
                await RunUiAsync(SendAgentAsync);
                return;
            }
            if (type == "open-link")
            {
                var href = GetString(root, "href", "");
                if (Uri.TryCreate(href, UriKind.Absolute, out var uri)
                    && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
                {
                    await Launcher.LaunchUriAsync(uri);
                }
            }
        }
        catch (Exception error)
        {
            App.LogException(error);
        }
    }

    private void OnBackendProgressReceived(object? sender, BackendProgressEventArgs args)
    {
        var progress = args.Result;
        if (progress.ValueKind != JsonValueKind.Object || GetString(progress, "type", "") != "agent-step")
        {
            return;
        }

        DispatcherQueue.TryEnqueue(() =>
        {
            var messageId = GetString(progress, "messageId", "");
            if (string.IsNullOrWhiteSpace(messageId)) return;
            if (progress.TryGetProperty("steps", out var steps))
            {
                var updated = SetAgentMessageSteps(messageId, steps.Clone(), isRunning: true);
                if (_selectedAgentMessageId == messageId)
                {
                    SetAgentStepsFromSteps(steps);
                }
                if (updated && _currentPage == "agent") RenderAgentMessages(_agentPreviewMessages);
            }
        });
    }

    private void SelectAgentMessage(string messageId)
    {
        if (string.IsNullOrWhiteSpace(messageId)) return;
        var message = _agentPreviewMessages.FirstOrDefault(item => item.Id == messageId && item.Role == "assistant");
        if (message is null) return;
        _selectedAgentMessageId = messageId;
        AgentStepsDrawer.Visibility = Visibility.Visible;
        ShowSelectedAgentSteps();
        if (_agentMarkdownWebViewUnavailable || _agentMarkdownWebView is null || _agentMarkdownWebView.Visibility != Visibility.Visible)
        {
            RenderAgentFallback(_agentPreviewMessages);
        }
    }

    private void ShowSelectedAgentSteps()
    {
        var message = _agentPreviewMessages.FirstOrDefault(item => item.Id == _selectedAgentMessageId && item.Role == "assistant");
        if (message is null)
        {
            SetAgentStepsMessage("点击一条助手消息查看执行过程。");
            return;
        }

        if (message.IsRunning && (!message.Steps.HasValue || message.Steps.Value.ValueKind != JsonValueKind.Array || message.Steps.Value.GetArrayLength() == 0))
        {
            SetAgentStepsMessage("正在请求模型...");
            return;
        }

        if (message.Steps.HasValue && message.Steps.Value.ValueKind == JsonValueKind.Array)
        {
            SetAgentStepsFromSteps(message.Steps.Value);
        }
        else
        {
            SetAgentStepsMessage("这条助手消息没有记录执行过程。");
        }
    }

    private bool SetAgentMessageSteps(string messageId, JsonElement steps, bool isRunning)
    {
        for (var index = 0; index < _agentPreviewMessages.Count; index += 1)
        {
            if (_agentPreviewMessages[index].Id == messageId)
            {
                _agentPreviewMessages[index] = _agentPreviewMessages[index] with { Steps = steps.Clone(), IsRunning = isRunning };
                return true;
            }
        }
        return false;
    }

    private void ReplaceAgentMessage(string messageId, string text, JsonElement? steps, bool isRunning)
    {
        for (var index = 0; index < _agentPreviewMessages.Count; index += 1)
        {
            if (_agentPreviewMessages[index].Id == messageId)
            {
                _agentPreviewMessages[index] = new AgentChatMessage(messageId, "assistant", text, steps, isRunning);
                return;
            }
        }

        _agentPreviewMessages.Add(new AgentChatMessage(messageId, "assistant", text, steps, isRunning));
    }

    private void SetAgentStepsMessage(string message)
    {
        AgentStepsTextBox.Text = message;
        AgentStepsStackPanel.Children.Clear();
        if (string.IsNullOrWhiteSpace(message))
        {
            return;
        }

        AgentStepsStackPanel.Children.Add(CreateAgentStepBlock("工作过程", message));
    }

    private void SetAgentStepsFromSteps(JsonElement steps)
    {
        AgentStepsTextBox.Text = FormatAgentSteps(steps);
        AgentStepsStackPanel.Children.Clear();
        if (steps.ValueKind != JsonValueKind.Array || steps.GetArrayLength() == 0)
        {
            SetAgentStepsMessage("这条助手消息没有记录执行过程。");
            return;
        }

        var index = 1;
        foreach (var step in steps.EnumerateArray())
        {
            AgentStepsStackPanel.Children.Add(CreateAgentStepBlock(index, step));
            index += 1;
        }
    }

    private static UIElement CreateAgentStepBlock(int index, JsonElement step)
    {
        var title = FirstString(step, "title", "kind");
        var kind = FirstString(step, "kind");
        var at = FirstString(step, "at", "time");
        var detail = FirstString(step, "detail", "message");

        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(new TextBlock
        {
            Text = $"{index}. {title}",
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextWrapping = TextWrapping.WrapWholeWords,
        });

        var meta = string.Join(" · ", new[] { StepKindLabel(kind), at }.Where(value => !string.IsNullOrWhiteSpace(value)));
        if (!string.IsNullOrWhiteSpace(meta))
        {
            body.Children.Add(new TextBlock
            {
                Text = meta,
                FontSize = 12,
                Foreground = ThemeBrush("TextFillColorSecondaryBrush"),
                TextWrapping = TextWrapping.WrapWholeWords,
            });
        }

        foreach (var element in CreateAgentStepDetailElements(detail))
        {
            body.Children.Add(element);
        }

        return WrapAgentStepBlock(body);
    }

    private static UIElement CreateAgentStepBlock(string title, string message)
    {
        var body = new StackPanel { Spacing = 6 };
        body.Children.Add(new TextBlock
        {
            Text = title,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        });
        body.Children.Add(new TextBlock
        {
            Text = message,
            TextWrapping = TextWrapping.WrapWholeWords,
            Foreground = ThemeBrush("TextFillColorSecondaryBrush"),
        });
        return WrapAgentStepBlock(body);
    }

    private static UIElement WrapAgentStepBlock(UIElement child)
    {
        return new Border
        {
            Padding = new Thickness(12),
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = ThemeBrush("CardStrokeColorDefaultBrush"),
            Background = ThemeBrush("CardBackgroundFillColorDefaultBrush"),
            Child = child,
        };
    }

    private static IEnumerable<UIElement> CreateAgentStepDetailElements(string detail)
    {
        if (string.IsNullOrWhiteSpace(detail))
        {
            yield break;
        }

        using var document = TryParseJson(detail);
        if (document is not null)
        {
            foreach (var element in CreateJsonSummaryElements(document.RootElement))
            {
                yield return element;
            }
            yield break;
        }

        yield return new TextBlock
        {
            Text = detail,
            TextWrapping = TextWrapping.WrapWholeWords,
        };
    }

    private static IEnumerable<UIElement> CreateJsonSummaryElements(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var rows = value.EnumerateObject()
                .Where(property => property.Name is not "raw" and not "html")
                .Take(12)
                .Select(property => (Name: AgentStepFieldLabel(property.Name), Value: SummarizeJsonValue(property.Value)))
                .Where(row => !string.IsNullOrWhiteSpace(row.Value))
                .ToList();

            if (rows.Count == 0)
            {
                yield return new TextBlock { Text = "结果为空。", Foreground = ThemeBrush("TextFillColorSecondaryBrush") };
                yield break;
            }

            foreach (var row in rows)
            {
                yield return CreateKeyValueText(row.Name, row.Value);
            }
            yield break;
        }

        if (value.ValueKind == JsonValueKind.Array)
        {
            var items = value.EnumerateArray().Take(6).Select(SummarizeJsonValue).Where(item => !string.IsNullOrWhiteSpace(item)).ToList();
            yield return new TextBlock
            {
                Text = items.Count == 0 ? "列表为空。" : string.Join("\n", items.Select((item, index) => $"{index + 1}. {item}")),
                TextWrapping = TextWrapping.WrapWholeWords,
            };
            yield break;
        }

        yield return new TextBlock
        {
            Text = SummarizeJsonValue(value),
            TextWrapping = TextWrapping.WrapWholeWords,
        };
    }

    private static UIElement CreateKeyValueText(string name, string value)
    {
        var panel = new StackPanel { Spacing = 2 };
        panel.Children.Add(new TextBlock
        {
            Text = name,
            FontSize = 12,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = ThemeBrush("TextFillColorSecondaryBrush"),
        });
        panel.Children.Add(new TextBlock
        {
            Text = value,
            TextWrapping = TextWrapping.WrapWholeWords,
        });
        return panel;
    }

    private static string SummarizeJsonValue(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.String => TruncateStepText(value.GetString() ?? ""),
            JsonValueKind.Number => value.ToString(),
            JsonValueKind.True => "是",
            JsonValueKind.False => "否",
            JsonValueKind.Null => "",
            JsonValueKind.Array => SummarizeJsonArray(value),
            JsonValueKind.Object => SummarizeJsonObject(value),
            _ => "",
        };
    }

    private static string SummarizeJsonArray(JsonElement value)
    {
        var count = value.GetArrayLength();
        if (count == 0) return "空列表";

        var primitiveItems = value.EnumerateArray()
            .Take(5)
            .Select(item => item.ValueKind is JsonValueKind.Object or JsonValueKind.Array ? "" : SummarizeJsonValue(item))
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .ToList();
        if (primitiveItems.Count > 0)
        {
            var suffix = count > primitiveItems.Count ? $" 等 {count} 项" : "";
            return $"{string.Join("、", primitiveItems)}{suffix}";
        }

        return $"{count} 项";
    }

    private static string SummarizeJsonObject(JsonElement value)
    {
        foreach (var key in new[] { "message", "title", "name", "status", "ok", "error", "summary", "text" })
        {
            if (value.TryGetProperty(key, out var property))
            {
                var summary = SummarizeJsonValue(property);
                if (!string.IsNullOrWhiteSpace(summary)) return summary;
            }
        }

        var fields = value.EnumerateObject()
            .Where(property => property.Value.ValueKind is JsonValueKind.String or JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False)
            .Take(5)
            .Select(property => $"{AgentStepFieldLabel(property.Name)}：{SummarizeJsonValue(property.Value)}")
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .ToList();
        return fields.Count > 0 ? string.Join("；", fields) : "对象";
    }

    private static JsonDocument? TryParseJson(string text)
    {
        try
        {
            return JsonDocument.Parse(text);
        }
        catch
        {
            return null;
        }
    }

    private static string TruncateStepText(string text)
    {
        var normalized = text.Replace("\r", "\n").Trim();
        return normalized.Length > 800 ? $"{normalized[..800]}..." : normalized;
    }

    private static string StepKindLabel(string kind)
    {
        return kind switch
        {
            "llm" => "模型",
            "tool" => "工具",
            "done" => "完成",
            _ => kind,
        };
    }

    private static string AgentStepFieldLabel(string name)
    {
        return name switch
        {
            "task_id" or "taskId" => "Task ID",
            "draft_id" or "draftId" => "草稿 ID",
            "filePath" or "path" => "路径",
            "fileName" or "name" => "名称",
            "title" => "标题",
            "message" => "信息",
            "status" => "状态",
            "ok" => "成功",
            "error" => "错误",
            "text" or "content" => "内容",
            "count" => "数量",
            "total" => "总数",
            "page" => "页码",
            "size" => "大小",
            _ => name,
        };
    }

    private void ShowConversation(JsonElement conversation)
    {
        var conversationId = FirstString(conversation, "id", "conversationId");
        var conversationChanged = !string.Equals(conversationId, _activeConversationId, StringComparison.Ordinal);
        if (conversationChanged)
        {
            _agentShouldFollowLatest = true;
            _agentScrollTop = 0;
            _selectedAgentMessageId = "";
            _expandedAgentProcessIds.Clear();
            AgentStepsDrawer.Visibility = Visibility.Collapsed;
        }
        _activeConversationId = conversationId;
        AgentConversationTitleText.Text = FirstString(conversation, "title") is { Length: > 0 } title
            ? title
            : _agentConversationCache.FirstOrDefault(item => item.Id == conversationId)?.Title ?? "新对话";
        ApplyAgentConversationFilter(conversationId);
        UpdateAgentContextMeter(conversation);
        _agentPreviewMessages.Clear();
        if (conversation.TryGetProperty("messages", out var messages) && messages.ValueKind == JsonValueKind.Array)
        {
            foreach (var message in messages.EnumerateArray())
            {
                var role = GetString(message, "role", "") == "user" ? "user" : "assistant";
                var id = FirstString(message, "id");
                var steps = message.TryGetProperty("steps", out var messageSteps) ? messageSteps.Clone() : (JsonElement?)null;
                _agentPreviewMessages.Add(new AgentChatMessage(
                    string.IsNullOrWhiteSpace(id) ? NewAgentMessageId() : id,
                    role,
                    FirstString(message, "text", "content", "message"),
                    steps,
                    GetString(message, "isRunning", "false") == "true"));
            }
        }
        if (!_agentPreviewMessages.Any(message => message.Id == _selectedAgentMessageId))
        {
            _selectedAgentMessageId = "";
        }
        RenderAgentMessages(_agentPreviewMessages);
        if (AgentStepsDrawer.Visibility == Visibility.Visible) ShowSelectedAgentSteps();
    }

    private void UpdateAgentContextMeter(JsonElement conversation)
    {
        if (!conversation.TryGetProperty("context", out var context) || context.ValueKind != JsonValueKind.Object)
        {
            AgentContextUsageText.Text = "上下文：尚未计算";
            AgentContextProgressBar.Value = 0;
            AgentContextStatusText.Text = "";
            return;
        }

        var current = GetString(context, "currentTokens", "0");
        var limit = GetString(context, "contextLength", "0");
        var percentText = GetString(context, "usagePercent", "0");
        _ = double.TryParse(percentText, out var percent);
        AgentContextProgressBar.Value = Math.Clamp(percent, 0, 100);
        AgentContextUsageText.Text = limit == "0"
            ? $"上下文：约 {current} tokens"
            : $"上下文：约 {current} / {limit} tokens";

        var compactedAt = GetString(context, "lastCompactedAt", "");
        var before = GetString(context, "lastBeforeTokens", "");
        var after = GetString(context, "lastAfterTokens", "");
        if (!string.IsNullOrWhiteSpace(compactedAt) && !string.IsNullOrWhiteSpace(before) && !string.IsNullOrWhiteSpace(after))
        {
            AgentContextStatusText.Text = $"上次压缩 {before} -> {after}";
        }
        else
        {
            AgentContextStatusText.Text = limit == "0" ? "设置上下文长度后启用自动压缩" : $"{percent:0}%";
        }
    }

    private void ShowHomeworkDetail(JsonElement detail)
    {
        var taskId = GetString(detail, "taskId", "");
        var title = FirstString(detail, "taskSummary.activityName", "taskSummary.title", "taskSummary.name", "taskTitle");
        var course = FirstString(detail, "taskSummary.courseName", "context.currentSubject.name", "subjectName");
        var deadline = FirstString(detail, "taskSummary.endTime", "taskSummary.deadline", "taskSummary.endDate");
        var releaseTime = FirstString(detail, "taskSummary.releaseTime", "releaseTime", "createTime");
        var creator = FirstString(detail, "taskSummary.createName", "teacherName", "creatorName");
        var scoreType = FirstString(detail, "taskSummary.scoreTypeName", "taskSummary.scoreCategory", "taskSummary.homeworkType");
        var status = FormatHomeworkStatus(detail);
        var content = FirstString(detail, "content", "readableText", "text", "taskText");
        var answer = FirstString(detail, "answer", "answerText", "referenceAnswer");

        DetailTitleText.Text = "作业详情";
        DetailTextBox.Visibility = Visibility.Collapsed;
        EditorTextBox.Visibility = Visibility.Collapsed;
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Source = new Uri("about:blank");
        WorkspaceImagePreview.Source = null;
        DetailImageCaption.Text = "";
        HomeworkDetailScrollViewer.Visibility = Visibility.Visible;
        HomeworkDetailStackPanel.Children.Clear();

        HomeworkDetailStackPanel.Children.Add(CreateHomeworkSection(
            "基本信息",
            CreateHomeworkMetadataGrid(
                ("作业名称", EmptyDash(title)),
                ("课程", EmptyDash(course)),
                ("截止时间", EmptyDash(deadline)),
                ("发布时间", EmptyDash(releaseTime)),
                ("发布人", EmptyDash(creator)),
                ("状态", EmptyDash(status)),
                ("评分方式", EmptyDash(scoreType)),
                ("Task ID", EmptyDash(taskId)))));

        HomeworkDetailStackPanel.Children.Add(CreateHomeworkSection(
            "作业内容",
            CreateHomeworkText(string.IsNullOrWhiteSpace(content) ? "暂无可读取正文。" : content)));

        HomeworkDetailStackPanel.Children.Add(CreateHomeworkSection(
            "附件",
            CreateHomeworkAttachmentList(detail, taskId)));

        if (!string.IsNullOrWhiteSpace(answer))
        {
            HomeworkDetailStackPanel.Children.Add(CreateHomeworkSection("参考内容 / 答案", CreateHomeworkText(answer)));
        }

        var readRows = new List<(string Label, string Value)>
        {
            ("作业正文字数", EmptyDash(GetString(detail, "contentLength", ""))),
            ("参考内容字数", EmptyDash(GetString(detail, "answerLength", ""))),
            ("正文是否截断", GetString(detail, "contentTruncated", "false") == "true" ? "是" : "否"),
            ("参考是否截断", GetString(detail, "answerTruncated", "false") == "true" ? "是" : "否"),
        };
        HomeworkDetailStackPanel.Children.Add(CreateHomeworkSection("读取状态", CreateHomeworkMetadataGrid(readRows.ToArray())));
    }

    private static string FormatHomeworkStatus(JsonElement detail)
    {
        var direct = FirstString(detail, "taskSummary.__statusText", "taskSummary.statusText", "taskSummary.score", "taskSummary.scoreLevel");
        if (!string.IsNullOrWhiteSpace(direct)) return direct;

        var participated = GetString(detail, "taskSummary.isParticipate", "");
        var correction = GetString(detail, "taskSummary.correction", "");
        var rows = new[]
        {
            participated == "true" ? "已参与" : participated == "false" ? "未参与" : null,
            correction == "true" ? "允许订正/补交" : correction == "false" ? "未开放订正/补交" : null,
        };
        return string.Join(" · ", rows.Where(row => !string.IsNullOrWhiteSpace(row)));
    }

    private static Border CreateHomeworkSection(string title, UIElement content)
    {
        var stack = new StackPanel { Spacing = 9 };
        stack.Children.Add(new TextBlock
        {
            Text = title,
            FontSize = 17,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        });
        stack.Children.Add(content);

        return new Border
        {
            Padding = new Thickness(14),
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = ThemeBrush("CardStrokeColorDefaultBrush"),
            Background = ThemeBrush("CardBackgroundFillColorDefaultBrush"),
            Child = stack,
        };
    }

    private static TextBlock CreateHomeworkText(string text)
    {
        return new TextBlock
        {
            Text = text,
            TextWrapping = TextWrapping.WrapWholeWords,
            LineHeight = 22,
        };
    }

    private static Grid CreateHomeworkMetadataGrid(params (string Label, string Value)[] rows)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(118) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        for (var index = 0; index < rows.Length; index += 1)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var label = new TextBlock
            {
                Text = rows[index].Label,
                Foreground = ThemeBrush("TextFillColorSecondaryBrush"),
                TextWrapping = TextWrapping.Wrap,
            };
            Grid.SetRow(label, index);
            Grid.SetColumn(label, 0);
            grid.Children.Add(label);

            var value = new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(rows[index].Value) ? "-" : rows[index].Value,
                TextWrapping = TextWrapping.WrapWholeWords,
            };
            Grid.SetRow(value, index);
            Grid.SetColumn(value, 1);
            grid.Children.Add(value);
        }

        return grid;
    }

    private UIElement CreateHomeworkAttachmentList(JsonElement detail, string taskId)
    {
        var stack = new StackPanel { Spacing = 8 };
        if (!detail.TryGetProperty("attachments", out var attachments) || attachments.ValueKind != JsonValueKind.Array)
        {
            stack.Children.Add(CreateHomeworkText("暂无附件。"));
            return stack;
        }

        var rows = attachments.EnumerateArray().ToList();
        if (rows.Count == 0)
        {
            stack.Children.Add(CreateHomeworkText("暂无附件。"));
            return stack;
        }

        foreach (var attachment in rows)
        {
            var fileId = FirstString(attachment, "fileId", "id");
            var name = FirstString(attachment, "fileName", "name", "filename");
            var fileExt = FirstString(attachment, "fileExt", "ext");
            var source = FormatAttachmentSource(FirstString(attachment, "source"));
            var size = FirstString(attachment, "fileSize", "size", "sizeBytes");
            var createTime = FirstString(attachment, "createTime", "uploaddate");
            var meta = string.Join(" · ", new[] { source, fileExt, string.IsNullOrWhiteSpace(size) ? null : $"{size} bytes", createTime, string.IsNullOrWhiteSpace(fileId) ? null : $"ID {fileId}" }.Where(value => !string.IsNullOrWhiteSpace(value)));

            var row = new Grid { ColumnSpacing = 12 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var textStack = new StackPanel { Spacing = 3 };
            textStack.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(name) ? "未命名附件" : name,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                TextWrapping = TextWrapping.WrapWholeWords,
            });
            textStack.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(meta) ? "附件" : meta,
                Foreground = ThemeBrush("TextFillColorSecondaryBrush"),
                TextWrapping = TextWrapping.WrapWholeWords,
            });
            Grid.SetColumn(textStack, 0);
            row.Children.Add(textStack);

            var button = new Button
            {
                Content = "下载到工作区",
                IsEnabled = !string.IsNullOrWhiteSpace(fileId),
                Tag = new AttachmentDownloadRequest(taskId, fileId, string.IsNullOrWhiteSpace(name) ? "附件" : name),
                VerticalAlignment = VerticalAlignment.Center,
            };
            button.Click += OnHomeworkAttachmentDownloadClick;
            Grid.SetColumn(button, 1);
            row.Children.Add(button);

            stack.Children.Add(new Border
            {
                Padding = new Thickness(10),
                CornerRadius = new CornerRadius(6),
                BorderThickness = new Thickness(1),
                BorderBrush = ThemeBrush("CardStrokeColorDefaultBrush"),
                Child = row,
            });
        }

        return stack;
    }

    private static string FormatAttachmentSource(string source) => source switch
    {
        "task" => "作业附件",
        "reference" => "参考附件",
        "my-submission" => "我的提交",
        "submitted" => "其他提交",
        _ => source,
    };

    private static string EmptyDash(string value) => string.IsNullOrWhiteSpace(value) ? "-" : value;

    private static Brush? ThemeBrush(string key)
    {
        return Application.Current.Resources.TryGetValue(key, out var value) ? value as Brush : null;
    }

    private void ShowDraft(JsonElement draft)
    {
        DetailTitleText.Text = GetString(draft, "taskTitle", $"任务 {GetString(draft, "taskId", "")}");
        DetailPrimaryButton.Content = "准备提交/私信";
        DetailSecondaryButton.Content = "驳回";
        SetDraftActionButtons(true);
        DetailTextBox.Visibility = Visibility.Collapsed;
        EditorTextBox.Visibility = Visibility.Visible;
        HomeworkDetailScrollViewer.Visibility = Visibility.Collapsed;
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Source = new Uri("about:blank");
        EditorTextBox.Text = GetString(draft, "draftText", "");
        var status = GetString(draft, "status", "");
        var retentionNotice = status == "rejected" ? " · 将在驳回 24 小时后自动删除" : "";
        SetStatus($"{FormatDraftStatus(status)} · {GetString(draft, "subjectName", "未知课程")}{retentionNotice}");
    }

    private void ShowPrivateThread(DisplayItem item, JsonElement result)
    {
        DetailTitleText.Text = PrivateContactLabel(item.Data);
        DetailTextBox.Visibility = Visibility.Collapsed;
        EditorTextBox.Visibility = Visibility.Collapsed;
        HomeworkDetailScrollViewer.Visibility = Visibility.Collapsed;
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Source = new Uri("about:blank");
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

    private static string GetString(JsonElement? root, string path, string fallback)
    {
        return root.HasValue ? GetString(root.Value, path, fallback) : fallback;
    }

    private static string NewAgentMessageId() => Guid.NewGuid().ToString("N");

    private static string FormatJson(JsonElement element) => JsonSerializer.Serialize(element, PrettyJsonOptions);

    private static string FormatAgentSteps(JsonElement steps)
    {
        if (steps.ValueKind != JsonValueKind.Array || steps.GetArrayLength() == 0)
        {
            return "这条助手消息没有记录执行过程。";
        }

        var rows = new List<string>();
        var index = 1;
        foreach (var step in steps.EnumerateArray())
        {
            var title = FirstString(step, "title", "kind");
            var kind = FirstString(step, "kind");
            var at = FirstString(step, "at", "time");
            var detail = FirstString(step, "detail", "message");
            var header = $"{index}. {title}";
            if (!string.IsNullOrWhiteSpace(kind))
            {
                header += $" [{kind}]";
            }
            if (!string.IsNullOrWhiteSpace(at))
            {
                header += $"\n   {at}";
            }
            if (!string.IsNullOrWhiteSpace(detail))
            {
                header += $"\n\n{detail}";
            }
            rows.Add(header);
            index += 1;
        }

        return string.Join("\n\n----------------\n\n", rows);
    }

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
            SetAgentStepsMessage("加载失败。");
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
        HomeworkDetailScrollViewer.Visibility = Visibility.Collapsed;
        HomeworkDetailStackPanel.Children.Clear();
        PrivateThreadListView.Visibility = Visibility.Collapsed;
        DetailImageScrollViewer.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Visibility = Visibility.Collapsed;
        DetailDocumentWebView.Source = new Uri("about:blank");
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
