import 'dart:async';
import 'dart:math' as math;

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../bridge/desktop_bridge.dart';
import '../models/models.dart';
import '../utils/formatters.dart';

enum TaskSortMode { latest, lowestGrade }

class AppController extends ChangeNotifier {
  AppController({DesktopBridge? bridge}) : _bridge = bridge ?? DesktopBridge();

  final DesktopBridge _bridge;

  DashboardData? dashboard;
  TaskDetail? selectedTaskDetail;
  String selectedCourseId = 'all';
  String? selectedTaskId;
  TaskSortMode sortMode = TaskSortMode.latest;
  bool booting = false;
  bool authenticating = false;
  bool refreshing = false;
  bool changingTerm = false;
  bool changingSubject = false;
  bool openingTask = false;
  bool submitting = false;
  String? bannerMessage;
  bool bannerIsError = false;
  List<XFile> selectedFiles = <XFile>[];
  final TextEditingController submitRemarkController = TextEditingController();
  final Set<String> _locallyReadNoticeIds = <String>{};
  
  // 私信相关状态
  List<PrivateContact> privateContacts = <PrivateContact>[];
  PrivateContact? selectedPrivateContact;
  List<PrivateMessage> privateMessages = <PrivateMessage>[];
  bool loadingPrivateContacts = false;
  bool loadingPrivateMessages = false;
  bool sendingPrivateMessage = false;
  bool loadingClassSubmitStats = false;
  final Map<String, ClassSubmissionStats> _classSubmitStats =
      <String, ClassSubmissionStats>{};
  Future<void>? _dashboardRefreshFuture;
  Future<void>? _gpaLoadFuture;
  bool _privateMessagesRequested = false;

  DashboardData? _derivedCacheDashboard;
  String? _derivedCacheCourseId;
  TaskSortMode? _derivedCacheSortMode;
  List<HomeworkTask>? _cachedVisibleTasks;
  List<HomeworkTask>? _cachedActionableTasks;
  Map<String, int>? _cachedCourseTaskCounts;
  int? _cachedRiskCount;
  int? _cachedPendingCount;

  @override
  void dispose() {
    submitRemarkController.dispose();
    unawaited(_bridge.shutdown());
    super.dispose();
  }

  bool get isLoggedIn => dashboard?.session.ready == true;

  SessionSummary? get session => dashboard?.session;

  SubjectSummary? get currentSubject => dashboard?.session.currentSubject;

  void _invalidateDerivedCache() {
    _derivedCacheDashboard = null;
    _derivedCacheCourseId = null;
    _derivedCacheSortMode = null;
    _cachedVisibleTasks = null;
    _cachedActionableTasks = null;
    _cachedCourseTaskCounts = null;
    _cachedRiskCount = null;
    _cachedPendingCount = null;
  }

  bool get _derivedCacheValid =>
      identical(_derivedCacheDashboard, dashboard) &&
      _derivedCacheCourseId == selectedCourseId &&
      _derivedCacheSortMode == sortMode;

  void _touchDerivedCache() {
    _derivedCacheDashboard = dashboard;
    _derivedCacheCourseId = selectedCourseId;
    _derivedCacheSortMode = sortMode;
  }

  List<HomeworkTask> get visibleTasks {
    if (_derivedCacheValid && _cachedVisibleTasks != null) {
      return _cachedVisibleTasks!;
    }
    final source = dashboard?.homework ?? const <HomeworkTask>[];
    final filtered = selectedCourseId == 'all'
        ? source
        : source.where((task) => task.courseId == selectedCourseId);
    final result = sortTasks(
      filtered,
      byLowestGrade: sortMode == TaskSortMode.lowestGrade,
    );
    _cachedVisibleTasks = result;
    _touchDerivedCache();
    return result;
  }

  List<HomeworkTask> get actionableTasks {
    if (_derivedCacheValid && _cachedActionableTasks != null) {
      return _cachedActionableTasks!;
    }
    final source = dashboard?.homework ?? const <HomeworkTask>[];
    final result = source.where(isActionableTask).toList();
    _cachedActionableTasks = result;
    _touchDerivedCache();
    return result;
  }

  Map<String, int> get courseTaskCounts {
    if (_derivedCacheValid && _cachedCourseTaskCounts != null) {
      return _cachedCourseTaskCounts!;
    }
    final counts = <String, int>{'all': dashboard?.homework.length ?? 0};
    for (final task in dashboard?.homework ?? const <HomeworkTask>[]) {
      if (task.courseId.isEmpty) {
        continue;
      }
      counts[task.courseId] = (counts[task.courseId] ?? 0) + 1;
    }
    _cachedCourseTaskCounts = counts;
    _touchDerivedCache();
    return counts;
  }

  ClassSubmissionStats? classSubmitStatsFor(HomeworkTask task) {
    return _classSubmitStats[task.id] ?? parseClassSubmissionStats(task.raw);
  }

  String? classSubmitPercentLabel(HomeworkTask task) {
    if (!isUnsubmittedTask(task) || task.isEnd) {
      return null;
    }
    return formatClassSubmitPercentLabel(classSubmitStatsFor(task));
  }

  Future<void> ensureClassSubmitStats() async {
    if (loadingClassSubmitStats || dashboard == null) {
      return;
    }

    final targets = dashboard!.homework
        .where(
          (task) =>
              isUnsubmittedTask(task) &&
              !task.isEnd &&
              !_classSubmitStats.containsKey(task.id) &&
              parseClassSubmissionStats(task.raw) == null &&
              task.id.isNotEmpty &&
              task.classId.isNotEmpty,
        )
        .take(8)
        .toList();
    if (targets.isEmpty) {
      return;
    }

    loadingClassSubmitStats = true;
    notifyListeners();
    try {
      final payloads = await _bridge.loadClassSubmitStatsBatch(
        targets
            .map((task) => (taskId: task.id, classId: task.classId))
            .toList(),
      );
      for (final task in targets) {
        final stats = _statsFromBridgePayload(payloads[task.id] ?? const {});
        if (stats != null) {
          _classSubmitStats[task.id] = stats;
        }
      }
    } catch (_) {
      // 提交比例是增强信息，失败时静默忽略。
    } finally {
      loadingClassSubmitStats = false;
      notifyListeners();
    }
  }

  Future<void> _loadGpaInBackground() async {
    if (dashboard == null || !isLoggedIn || dashboard!.gpa != null) {
      return;
    }
    if (_gpaLoadFuture != null) {
      await _gpaLoadFuture;
      return;
    }
    _gpaLoadFuture = _loadGpaInBackgroundImpl();
    try {
      await _gpaLoadFuture;
    } finally {
      _gpaLoadFuture = null;
    }
  }

  Future<void> _loadGpaInBackgroundImpl() async {
    try {
      final gpa = await _bridge.loadGpa();
      if (gpa == null || dashboard == null) {
        return;
      }
      dashboard = dashboard!.copyWith(gpa: gpa);
      notifyListeners();
    } catch (_) {
      // GPA 是增强信息，失败时静默忽略。
    }
  }

  void _applySubjectUpdate(SubjectUpdateResult result) {
    if (result.dashboard != null) {
      dashboard = result.dashboard;
      _invalidateDerivedCache();
      _reconcileNoticeReadState();
      return;
    }
    final session = result.session;
    if (session != null && dashboard != null) {
      dashboard = dashboard!.copyWith(session: session);
    }
  }

  void _cacheClassSubmitStatsFromDetail(
    HomeworkTask task,
    TaskDetail? detail,
  ) {
    if (detail == null || !isUnsubmittedTask(task)) {
      return;
    }

    var stats = parseClassSubmissionStats(task.raw);
    if (stats?.percent != null) {
      _classSubmitStats[task.id] = stats!;
      return;
    }

    final submitted = detail.otherSubmissionCount;
    final total = stats?.totalCount;
    if (submitted > 0 && total != null && total > 0) {
      _classSubmitStats[task.id] = ClassSubmissionStats(
        submittedCount: submitted,
        totalCount: total,
        percent: ((submitted / total) * 100).round().clamp(0, 100),
      );
    }
  }

  ClassSubmissionStats? _statsFromBridgePayload(JsonMap payload) {
    final percent = _intValue(payload['percent']);
    final submitted = _intValue(payload['submittedCount']);
    final total = _intValue(payload['totalCount']);
    if (percent == null && submitted == null && total == null) {
      return null;
    }
    return ClassSubmissionStats(
      submittedCount: submitted,
      totalCount: total,
      percent: percent,
    );
  }

  int? _intValue(dynamic value) {
    if (value is int) {
      return value;
    }
    if (value is num) {
      return value.round();
    }
    return int.tryParse(value?.toString() ?? '');
  }

  int get pendingCount {
    if (_derivedCacheValid && _cachedPendingCount != null) {
      return _cachedPendingCount!;
    }
    final result = actionableTasks.length;
    _cachedPendingCount = result;
    return result;
  }

  int get riskCount {
    if (_derivedCacheValid && _cachedRiskCount != null) {
      return _cachedRiskCount!;
    }
    final result = countRiskTasks(dashboard?.homework ?? const <HomeworkTask>[]);
    _cachedRiskCount = result;
    return result;
  }

  int get unreadNoticeCount {
    final notices = this.notices;
    final loadedUnread = notices
        .where((notice) => !isNoticeRead(notice))
        .length;
    final serverUnread = dashboard?.unreadCount?.noticeNotReceipt ?? 0;
    final locallyConsumedServerUnread = notices
        .where(
          (notice) => !notice.read && _locallyReadNoticeIds.contains(notice.id),
        )
        .length;
    if (serverUnread > 0) {
      return math.max(
        loadedUnread,
        math.max(0, serverUnread - locallyConsumedServerUnread),
      );
    }
    if (notices.isNotEmpty) {
      return loadedUnread;
    }
    final summaryCount = dashboard?.unreadCount?.noticeNotReceipt ?? 0;
    if (summaryCount > 0) {
      return summaryCount;
    }
    return loadedUnread;
  }

  int get noticeCount => dashboard?.notices.length ?? 0;

  List<NoticeSummary> get notices =>
      dashboard?.notices ?? const <NoticeSummary>[];
  
  int get unreadPrivateMessageCount {
    return privateContacts.fold<int>(
      0,
      (sum, contact) => sum + contact.unreadNum,
    );
  }

  bool isNoticeRead(NoticeSummary notice) {
    return notice.read || _locallyReadNoticeIds.contains(notice.id);
  }

  bool get canMarkAllNoticesRead {
    return notices.any((notice) => !isNoticeRead(notice));
  }

  HomeworkTask? get selectedTask {
    final taskId = selectedTaskId;
    if (taskId == null) {
      return null;
    }
    for (final task in dashboard?.homework ?? const <HomeworkTask>[]) {
      if (task.id == taskId) {
        return task;
      }
    }
    return null;
  }

  CourseSummary? courseForTask(HomeworkTask? task) {
    if (task == null) {
      return null;
    }
    for (final course in dashboard?.courses ?? const <CourseSummary>[]) {
      if (course.id == task.courseId) {
        return course;
      }
    }
    return null;
  }

  Future<void> initialize() async {
    booting = true;
    notifyListeners();
    try {
      dashboard = await _bridge.loadDashboard(includeGpa: true);
      _invalidateDerivedCache();
      _reconcileNoticeReadState();
      unawaited(_loadGpaInBackground());
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      booting = false;
      notifyListeners();
    }
  }

  Future<void> refreshDashboard({bool silent = false}) async {
    if (_dashboardRefreshFuture != null) {
      await _dashboardRefreshFuture;
      return;
    }
    _dashboardRefreshFuture = _refreshDashboardImpl(silent: silent);
    try {
      await _dashboardRefreshFuture;
    } finally {
      _dashboardRefreshFuture = null;
    }
  }

  Future<void> _refreshDashboardImpl({required bool silent}) async {
    if (!silent) {
      refreshing = true;
      notifyListeners();
    }
    try {
      dashboard = await _bridge.loadDashboard(includeGpa: true);
      _invalidateDerivedCache();
      _resetClassSubmitStats();
      _reconcileSelections();
      _reconcileNoticeReadState();
      if (!silent) {
        _setBanner('已刷新最新数据。');
      }
      unawaited(_loadGpaInBackground());
    } catch (error) {
      if (!silent) {
        _setBanner(_errorText(error), isError: true);
      }
    } finally {
      if (!silent) {
        refreshing = false;
        notifyListeners();
      } else if (dashboard != null) {
        notifyListeners();
      }
    }
  }

  Future<void> loginInBrowser() async {
    authenticating = true;
    notifyListeners();
    try {
      dashboard = await _bridge.loginInBrowser();
      _invalidateDerivedCache();
      _resetSelections();
      _reconcileNoticeReadState();
      _setBanner('登录成功。');
      unawaited(_loadGpaInBackground());
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      authenticating = false;
      notifyListeners();
    }
  }

  Future<void> loginWithCredentials({
    required String username,
    required String password,
  }) async {
    authenticating = true;
    notifyListeners();
    try {
      dashboard = await _bridge.loginWithCredentials(
        username: username,
        password: password,
      );
      _invalidateDerivedCache();
      _resetSelections();
      _reconcileNoticeReadState();
      _setBanner('登录成功。');
      unawaited(_loadGpaInBackground());
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      authenticating = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    authenticating = true;
    notifyListeners();
    try {
      dashboard = await _bridge.logout();
      _invalidateDerivedCache();
      _resetSelections();
      _privateMessagesRequested = false;
      privateContacts = <PrivateContact>[];
      privateMessages = <PrivateMessage>[];
      selectedPrivateContact = null;
      _locallyReadNoticeIds.clear();
      _setBanner('已退出登录。');
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      authenticating = false;
      notifyListeners();
    }
  }

  Future<void> setCurrentTerm(String termId) async {
    if (termId.isEmpty) {
      return;
    }
    changingTerm = true;
    notifyListeners();
    try {
      dashboard = await _bridge.setTerm(termId);
      _invalidateDerivedCache();
      _resetSelections();
      _reconcileNoticeReadState();
      _setBanner('学期已切换。');
      unawaited(_loadGpaInBackground());
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      changingTerm = false;
      notifyListeners();
    }
  }

  Future<void> setCurrentSubject(SubjectSummary subject) async {
    if (subject.id.isEmpty) {
      return;
    }
    changingSubject = true;
    notifyListeners();
    try {
      final result = await _bridge.setSubject(
        subjectId: subject.id,
        subjectName: subject.name,
        classId: subject.classId,
      );
      _applySubjectUpdate(result);
      _resetSelections();
      _setBanner('当前科目已切换到 ${subject.name}。');
      unawaited(_loadGpaInBackground());
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      changingSubject = false;
      notifyListeners();
    }
  }

  void _resetClassSubmitStats() {
    _classSubmitStats.clear();
  }

  void selectCourse(String courseId) {
    selectedCourseId = courseId;
    final visibleIds = visibleTasks.map((task) => task.id).toSet();
    if (selectedTaskId != null && !visibleIds.contains(selectedTaskId)) {
      selectedTaskId = null;
      selectedTaskDetail = null;
      selectedFiles = <XFile>[];
      submitRemarkController.clear();
    }
    notifyListeners();
  }

  void setSortMode(TaskSortMode mode) {
    sortMode = mode;
    notifyListeners();
  }

  SubjectSummary? subjectForCourse(CourseSummary course) {
    for (final subject
        in dashboard?.session.availableSubjects ?? const <SubjectSummary>[]) {
      if (subject.id == course.id || subject.classId == course.classId) {
        return subject;
      }
    }
    return null;
  }

  Future<void> openTask(HomeworkTask task) async {
    openingTask = true;
    selectedTaskId = task.id;
    notifyListeners();
    try {
      final currentSubject = dashboard?.session.currentSubject;
      final needsSubjectChange =
          currentSubject?.id != task.courseId ||
          currentSubject?.classId != task.classId;
      if (needsSubjectChange && task.courseId.isNotEmpty) {
        final result = await _bridge.setSubject(
          subjectId: task.courseId,
          subjectName: task.courseName,
          classId: task.classId,
        );
        _applySubjectUpdate(result);
      }
      selectedTaskDetail = await _bridge.openTask(task.id);
      _cacheClassSubmitStatsFromDetail(task, selectedTaskDetail);
      selectedFiles = <XFile>[];
      submitRemarkController.clear();
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      openingTask = false;
      notifyListeners();
    }
  }

  Future<void> downloadAttachment(AttachmentInfo attachment) async {
    final detail = selectedTaskDetail;
    if (detail == null) {
      return;
    }
    try {
      final downloaded = await _bridge.downloadAttachment(
        taskId: detail.taskId,
        fileId: attachment.fileId,
      );
      await _bridge.openTarget(
        downloaded.uri.isNotEmpty ? downloaded.uri : downloaded.path,
      );
      _setBanner('已下载 ${downloaded.fileName}。');
      notifyListeners();
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
      notifyListeners();
    }
  }

  Future<void> pickFiles() async {
    try {
      final files = await openFiles();
      if (files.isEmpty) {
        return;
      }
      final merged = <String, XFile>{};
      for (final file in selectedFiles) {
        merged[file.path] = file;
      }
      for (final file in files) {
        merged[file.path] = file;
      }
      selectedFiles = merged.values.toList();
      notifyListeners();
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
      notifyListeners();
    }
  }

  void removeSelectedFile(XFile file) {
    selectedFiles = selectedFiles
        .where((item) => item.path != file.path)
        .toList();
    notifyListeners();
  }

  Future<void> submitSelectedTask() async {
    final detail = selectedTaskDetail;
    if (detail == null) {
      _setBanner('请先打开一项作业。', isError: true);
      notifyListeners();
      return;
    }
    final remark = submitRemarkController.text.trim();
    final filePaths = selectedFiles.map((file) => file.path).toList();
    if (remark.isEmpty && filePaths.isEmpty) {
      _setBanner('请至少填写备注或选择一个文件。', isError: true);
      notifyListeners();
      return;
    }

    submitting = true;
    notifyListeners();
    try {
      await _bridge.submitTask(
        taskId: detail.taskId,
        remark: remark,
        filePaths: filePaths,
      );
      _setBanner('作业已提交。');
      selectedFiles = <XFile>[];
      submitRemarkController.clear();
      selectedTaskDetail = null;
      unawaited(refreshDashboard(silent: true));
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      submitting = false;
      notifyListeners();
    }
  }

  void clearBanner() {
    bannerMessage = null;
    bannerIsError = false;
    notifyListeners();
  }

  void markNoticeRead(NoticeSummary notice, {bool silent = false}) {
    if (notice.id.isEmpty || isNoticeRead(notice)) {
      return;
    }
    _locallyReadNoticeIds.add(notice.id);
    if (!silent) {
      _setBanner('已标记为已读。');
    }
    notifyListeners();
  }

  void markAllNoticesRead() {
    final unreadIds = notices
        .where((notice) => !isNoticeRead(notice) && notice.id.isNotEmpty)
        .map((notice) => notice.id)
        .toList();
    if (unreadIds.isEmpty) {
      return;
    }
    _locallyReadNoticeIds.addAll(unreadIds);
    _setBanner('已将当前通知列表标记为已读。');
    notifyListeners();
  }

  void _setBanner(String message, {bool isError = false}) {
    bannerMessage = message;
    bannerIsError = isError;
  }

  void _resetSelections() {
    _resetClassSubmitStats();
    selectedCourseId = 'all';
    selectedTaskId = null;
    selectedTaskDetail = null;
    selectedFiles = <XFile>[];
    submitRemarkController.clear();
    sortMode = TaskSortMode.latest;
  }

  void _reconcileSelections() {
    final courseIds = {
      'all',
      ...?dashboard?.courses.map((course) => course.id),
    };
    if (!courseIds.contains(selectedCourseId)) {
      selectedCourseId = 'all';
    }
    final taskIds = visibleTasks.map((task) => task.id).toSet();
    if (selectedTaskId != null && !taskIds.contains(selectedTaskId)) {
      selectedTaskId = null;
      selectedTaskDetail = null;
    }
  }

  void _reconcileNoticeReadState() {
    final noticeIds = notices
        .map((notice) => notice.id)
        .where((id) => id.isNotEmpty)
        .toSet();
    _locallyReadNoticeIds.retainWhere(noticeIds.contains);
  }

  String _errorText(Object error) {
    return error is StateError ? error.message : error.toString();
  }
  
  Future<void> ensurePrivateMessagesLoaded() async {
    if (_privateMessagesRequested && privateContacts.isNotEmpty) {
      return;
    }
    _privateMessagesRequested = true;
    await loadPrivateContacts();
  }

  // 私信相关方法
  Future<void> loadPrivateContacts() async {
    loadingPrivateContacts = true;
    notifyListeners();
    try {
      final result = await _bridge.listPrivateContacts();
      privateContacts = result;
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      loadingPrivateContacts = false;
      notifyListeners();
    }
  }

  Future<void> loadMessageThread(PrivateContact contact) async {
    selectedPrivateContact = contact;
    loadingPrivateMessages = true;
    notifyListeners();
    try {
      final result = await _bridge.getPrivateMessageThread(contact);
      privateMessages = result;
      
      // 打开消息后，清除该联系人的未读数
      final updatedContacts = privateContacts.map((c) {
        if (c.id == contact.id && c.unreadNum > 0) {
          return PrivateContact(
            id: c.id,
            classId: c.classId,
            className: c.className,
            peerId: c.peerId,
            peerName: c.peerName,
            peerType: c.peerType,
            unreadNum: 0, // 清除未读数
            lastTime: c.lastTime,
            lastContent: c.lastContent,
            peerAvatar: c.peerAvatar,
            peerSexCode: c.peerSexCode,
            courseName: c.courseName,
            courseColor: c.courseColor,
            raw: c.raw,
          );
        }
        return c;
      }).toList();
      privateContacts = updatedContacts;
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      loadingPrivateMessages = false;
      notifyListeners();
    }
  }

  Future<void> sendPrivateMessage(
    PrivateContact contact,
    String content,
  ) async {
    if (content.trim().isEmpty) {
      _setBanner('消息内容不能为空。', isError: true);
      notifyListeners();
      return;
    }

    sendingPrivateMessage = true;
    notifyListeners();
    try {
      final sentMessage = await _bridge.sendPrivateMessage(contact, content);
      privateMessages = <PrivateMessage>[...privateMessages, sentMessage];
      _setBanner('消息已发送。');
      
      // 更新联系人列表中的最后消息
      final updatedContacts = privateContacts.map((c) {
        if (c.id == contact.id) {
          return PrivateContact(
            id: c.id,
            classId: c.classId,
            className: c.className,
            peerId: c.peerId,
            peerName: c.peerName,
            peerType: c.peerType,
            unreadNum: c.unreadNum,
            lastTime: sentMessage.createTime,
            lastContent: content,
            peerAvatar: c.peerAvatar,
            peerSexCode: c.peerSexCode,
            courseName: c.courseName,
            courseColor: c.courseColor,
            raw: c.raw,
          );
        }
        return c;
      }).toList();
      privateContacts = updatedContacts;
    } catch (error) {
      _setBanner(_errorText(error), isError: true);
    } finally {
      sendingPrivateMessage = false;
      notifyListeners();
    }
  }
}
