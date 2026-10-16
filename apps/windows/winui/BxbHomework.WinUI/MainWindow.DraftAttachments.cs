using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Streams;

namespace BxbHomework.WinUI;

public sealed partial class MainWindow
{
    private readonly HashSet<string> _selectedDraftAttachmentIds = new(StringComparer.Ordinal);
    private readonly HashSet<string> _knownDraftAttachmentIds = new(StringComparer.Ordinal);
    private string _attachmentDraftId = "";

    private void RenderDraftAttachments(JsonElement draft)
    {
        var draftId = GetString(draft, "draftId", "");
        if (_attachmentDraftId != draftId)
        {
            _selectedDraftAttachmentIds.Clear();
            _knownDraftAttachmentIds.Clear();
            _attachmentDraftId = draftId;
        }
        var attachments = ReadArray(draft, "attachments");
        var currentIds = attachments.Select(file => GetString(file, "id", "")).ToHashSet(StringComparer.Ordinal);
        _selectedDraftAttachmentIds.IntersectWith(currentIds);
        foreach (var id in currentIds.Except(_knownDraftAttachmentIds)) _selectedDraftAttachmentIds.Add(id);
        _knownDraftAttachmentIds.Clear();
        _knownDraftAttachmentIds.UnionWith(currentIds);
        var status = GetString(draft, "status", "");
        if (status is "submitted" or "sent_to_teacher")
        {
            _selectedDraftAttachmentIds.Clear();
            if (status == "submitted" && draft.TryGetProperty("submission", out var submission) && submission.ValueKind == JsonValueKind.Object)
                _selectedDraftAttachmentIds.UnionWith(ReadArray(submission, "attachments").Select(file => GetString(file, "id", "")));
        }
        var attemptStatus = draft.TryGetProperty("deliveryAttempt", out var attempt) ? GetString(attempt, "status", "") : "";
        var messageStatus = draft.TryGetProperty("teacherMessageAttempt", out var message) ? GetString(message, "status", "") : "";
        var hasConfirmedMessages = message.ValueKind == JsonValueKind.Object && ReadArray(message, "confirmedMessages").Count > 0;
        var editable = status is not ("submitted" or "sent_to_teacher")
            && attemptStatus is not ("in_flight" or "unknown")
            && messageStatus is not ("in_flight" or "unknown" or "ready")
            && !(messageStatus == "failed" && hasConfirmedMessages);
        DraftAddAttachmentButton.IsEnabled = editable;
        DraftAttachmentRowsPanel.Children.Clear();
        if (attachments.Count == 0)
        {
            DraftAttachmentRowsPanel.Children.Add(new TextBlock { Text = "尚未绑定附件。可从工作区添加，或让助手生成代码截图并绑定到此草稿。", TextWrapping = TextWrapping.Wrap });
        }
        foreach (var attachment in attachments)
        {
            var id = GetString(attachment, "id", "");
            var row = new StackPanel { Spacing = 5 };
            var select = new CheckBox
            {
                Content = DraftAttachmentLabel(attachment),
                IsChecked = _selectedDraftAttachmentIds.Contains(id),
                IsEnabled = editable,
            };
            select.Checked += (_, _) => _selectedDraftAttachmentIds.Add(id);
            select.Unchecked += (_, _) => _selectedDraftAttachmentIds.Remove(id);
            row.Children.Add(select);
            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var preview = new Button { Content = "放大预览" };
            preview.Click += async (_, _) => await RunUiAsync(() => PreviewDraftAttachmentAsync(draftId, id));
            actions.Children.Add(preview);
            var remove = new Button { Content = "移除", IsEnabled = editable };
            remove.Click += async (_, _) => await RunUiAsync(async () =>
            {
                if (!_selectedDraft.HasValue || GetString(_selectedDraft.Value, "draftId", "") != draftId) return;
                await SaveDraftAttachmentsAsync(draftId, ReadArray(_selectedDraft.Value, "attachments")
                    .Where(file => GetString(file, "id", "") != id)
                    .Select(file => (object)new { attachment_id = GetString(file, "id", "") }).ToArray());
            });
            actions.Children.Add(remove);
            row.Children.Add(actions);
            var inlinePreview = new Expander
            {
                Header = "展开附件内容", HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
            };
            var loaded = false;
            inlinePreview.Expanding += async (_, _) =>
            {
                if (loaded) return;
                await RunUiAsync(async () =>
                {
                    inlinePreview.Content = new TextBlock { Text = "正在读取并校验附件…" };
                    try
                    {
                        var file = await ToolAsync("preview_submission_draft_attachment", new { draft_id = draftId, attachment_id = id });
                        inlinePreview.Content = await BuildDraftAttachmentPreviewAsync(file, compact: true);
                        loaded = true;
                    }
                    catch
                    {
                        inlinePreview.Content = new TextBlock { Text = "预览失败。重新展开可重试，或移除此附件后重新绑定。", TextWrapping = TextWrapping.Wrap };
                        throw;
                    }
                });
            };
            row.Children.Add(inlinePreview);
            DraftAttachmentRowsPanel.Children.Add(row);
        }
    }

    private static string DraftAttachmentLabel(JsonElement attachment)
    {
        var kind = GetString(attachment, "kind", "file") switch { "source" => "源代码", "image" => "截图/图片", _ => "文件" };
        long.TryParse(GetString(attachment, "sizeBytes", "0"), out var bytes);
        return $"{kind} · {GetString(attachment, "fileName", "附件")} · {FormatByteCount(bytes)}";
    }

    private async void OnDraftAddAttachmentClick(object sender, RoutedEventArgs args)
    {
        await RunUiAsync(async () =>
        {
            if (!_selectedDraft.HasValue) return;
            var draftId = GetString(_selectedDraft.Value, "draftId", "");
            var result = await ToolAsync("list_workspace_files", new { max_files = 300 });
            var files = ReadArray(result, "files");
            var list = new ListView { SelectionMode = ListViewSelectionMode.Multiple, MaxHeight = 400 };
            foreach (var file in files)
            {
                list.Items.Add(new ListViewItem
                {
                    Content = GetString(file, "relativePath", GetString(file, "name", "")),
                    Tag = file.Clone(),
                });
            }
            var content = new StackPanel { Spacing = 10, MinWidth = 320 };
            content.Children.Add(new TextBlock { Text = "选择工作区文件（最多 20 个附件，每个不超过 25 MB）。绑定会同时保存当前正文，并重新进入待审核状态。", TextWrapping = TextWrapping.Wrap });
            if (files.Count == 0) content.Children.Add(new TextBlock { Text = "工作区暂无文件，请先将文件保存到工作区。" });
            content.Children.Add(list);
            var dialog = new ContentDialog
            {
                XamlRoot = RootNavigation.XamlRoot,
                Title = "添加草稿附件",
                Content = content,
                PrimaryButtonText = "绑定所选文件",
                CloseButtonText = "取消",
                IsPrimaryButtonEnabled = false,
            };
            list.SelectionChanged += (_, _) => dialog.IsPrimaryButtonEnabled = list.SelectedItems.Count > 0;
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
            if (!_selectedDraft.HasValue || GetString(_selectedDraft.Value, "draftId", "") != draftId) return;
            var entries = ReadArray(_selectedDraft.Value, "attachments")
                .Select(file => (object)new { attachment_id = GetString(file, "id", "") }).ToList();
            entries.AddRange(list.SelectedItems.OfType<ListViewItem>()
                .Select(item => (object)new { file = GetString((JsonElement)item.Tag, "relativePath", "") }));
            await SaveDraftAttachmentsAsync(draftId, entries.ToArray());
        });
    }

    private async Task SaveDraftAttachmentsAsync(string draftId, object[] attachments)
    {
        var result = await ToolAsync("update_submission_draft", new
        {
            draft_id = draftId,
            draft_text = EditorTextBox.Text.Trim(),
            attachments,
        });
        if (!_selectedDraft.HasValue || GetString(_selectedDraft.Value, "draftId", "") != draftId) return;
        var draft = result.GetProperty("draft").Clone();
        var loadVersion = _pageLoadVersion;
        await LoadDraftsAsync((FilterComboBox.SelectedItem as ComboItem)?.Key ?? "all");
        if (!IsCurrentPageLoad("drafts", loadVersion)) return;
        _selectedDraft = draft;
        ShowDraft(draft);
    }

    private async Task PreviewDraftAttachmentAsync(string draftId, string attachmentId)
    {
        var file = await ToolAsync("preview_submission_draft_attachment", new { draft_id = draftId, attachment_id = attachmentId });
        var content = await BuildDraftAttachmentPreviewAsync(file);
        var dialog = new ContentDialog
        {
            XamlRoot = RootNavigation.XamlRoot, Title = GetString(file, "fileName", "附件预览"),
            Content = new ScrollViewer { Content = content, MaxHeight = 650 },
            PrimaryButtonText = "打开所在文件夹", CloseButtonText = "关闭",
        };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            var directory = Path.GetDirectoryName(GetString(file, "path", ""));
            if (!string.IsNullOrWhiteSpace(directory)) await Windows.System.Launcher.LaunchFolderPathAsync(directory);
        }
    }

    private async Task<StackPanel> BuildDraftAttachmentPreviewAsync(JsonElement file, bool compact = false)
    {
        var content = new StackPanel { Spacing = 10, MinWidth = compact ? 0 : 320, MaxWidth = 900 };
        content.Children.Add(new TextBlock { Text = DraftAttachmentLabel(file), TextWrapping = TextWrapping.Wrap });
        if (GetString(file, "previewType", "") == "image")
        {
            var dataUrl = GetString(file, "dataUrl", "");
            var bytes = Convert.FromBase64String(dataUrl[(dataUrl.IndexOf(',') + 1)..]);
            using var stream = new InMemoryRandomAccessStream();
            await stream.WriteAsync(bytes.AsBuffer());
            stream.Seek(0);
            var bitmap = new BitmapImage();
            await bitmap.SetSourceAsync(stream);
            content.Children.Add(new Image { Source = bitmap, Stretch = Stretch.Uniform, MaxHeight = compact ? 220 : 600 });
        }
        else if (GetString(file, "previewType", "") == "text")
        {
            var textPreview = new TextBox
            {
                Text = GetString(file, "text", ""), AcceptsReturn = true, IsReadOnly = true,
                FontFamily = new FontFamily("Consolas"), TextWrapping = TextWrapping.NoWrap,
                MinHeight = compact ? 100 : 240, MaxHeight = compact ? 220 : 540,
            };
            ScrollViewer.SetHorizontalScrollBarVisibility(textPreview, ScrollBarVisibility.Auto);
            ScrollViewer.SetVerticalScrollBarVisibility(textPreview, ScrollBarVisibility.Auto);
            content.Children.Add(textPreview);
            if (GetString(file, "truncated", "false") == "true")
                content.Children.Add(new TextBlock { Text = "内容较长，预览已截断；提交时使用完整附件。" });
        }
        else content.Children.Add(new TextBlock { Text = "此类型暂不支持内容预览。文件副本已经校验，可从所在文件夹查看。", TextWrapping = TextWrapping.Wrap });
        return content;
    }

    private void RenderDraftDeliveryAttachments(JsonElement preview, string target)
    {
        DraftDeliveryAttachmentsPanel.Children.Clear();
        if (!_selectedDraft.HasValue) return;
        if (target == "teacher_private_message")
        {
            DraftDeliveryAttachmentsPanel.Children.Add(new TextBlock { Text = "私信仅发送上方正文；草稿绑定的源代码、截图和其他文件不会通过私信发送。", TextWrapping = TextWrapping.Wrap });
            return;
        }
        var files = ReadArray(preview, "selectedAttachments");
        DraftDeliveryAttachmentsPanel.Children.Add(new TextBlock { Text = $"本次上传附件：{files.Count} 个", FontSize = 16 });
        if (files.Count == 0) DraftDeliveryAttachmentsPanel.Children.Add(new TextBlock { Text = "没有选择新附件。返回草稿可调整勾选。", TextWrapping = TextWrapping.Wrap });
        var draftId = GetString(_selectedDraft.Value, "draftId", "");
        foreach (var file in files)
        {
            var attachmentId = GetString(file, "id", "");
            var button = new Button { Content = DraftAttachmentLabel(file) + " · 预览" };
            button.Click += async (_, _) => await RunUiAsync(() => PreviewDraftAttachmentAsync(draftId, attachmentId));
            DraftDeliveryAttachmentsPanel.Children.Add(button);
        }
    }
}
