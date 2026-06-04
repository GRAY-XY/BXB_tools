import 'dart:convert';

typedef JsonMap = Map<String, dynamic>;

String _stringValue(dynamic value) {
  if (value == null) {
    return '';
  }
  return value.toString();
}

int? _intValue(dynamic value) {
  if (value == null) {
    return null;
  }
  if (value is int) {
    return value;
  }
  return int.tryParse(value.toString());
}

bool _boolValue(dynamic value) {
  if (value is bool) {
    return value;
  }
  if (value is num) {
    return value != 0;
  }
  final text = value?.toString().trim().toLowerCase();
  return text == 'true' || text == '1';
}

JsonMap _mapValue(dynamic value) {
  if (value is JsonMap) {
    return value;
  }
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return <String, dynamic>{};
}

List<JsonMap> _mapList(dynamic value) {
  if (value is! List) {
    return const <JsonMap>[];
  }
  return value.map(_mapValue).toList();
}

class DashboardData {
  DashboardData({
    required this.session,
    required this.terms,
    required this.courses,
    required this.homework,
    required this.pendingHomework,
    required this.schedule,
    required this.timeSlots,
    required this.notices,
    required this.unreadCount,
    this.gpa,
  });

  factory DashboardData.fromJson(JsonMap json) {
    final rawSchedule = _mapValue(json['schedule']);
    final parsedSchedule = <int, Map<int, ScheduleSlot>>{};
    for (final dayEntry in rawSchedule.entries) {
      final dayKey = int.tryParse(dayEntry.key);
      if (dayKey == null) {
        continue;
      }
      final daySlots = <int, ScheduleSlot>{};
      for (final slotEntry in _mapValue(dayEntry.value).entries) {
        final slotKey = int.tryParse(slotEntry.key);
        if (slotKey == null) {
          continue;
        }
        daySlots[slotKey] = ScheduleSlot.fromJson(_mapValue(slotEntry.value));
      }
      parsedSchedule[dayKey] = daySlots;
    }

    final rawTimeSlots = _mapValue(json['timeSlots']);
    final parsedTimeSlots = <int, String>{};
    for (final entry in rawTimeSlots.entries) {
      final slotKey = int.tryParse(entry.key);
      if (slotKey == null) {
        continue;
      }
      parsedTimeSlots[slotKey] = _stringValue(entry.value);
    }

    return DashboardData(
      session: SessionSummary.fromJson(_mapValue(json['session'])),
      terms: _mapList(json['terms']).map(TermSummary.fromJson).toList(),
      courses: _mapList(json['courses']).map(CourseSummary.fromJson).toList(),
      homework: _mapList(json['homework']).map(HomeworkTask.fromJson).toList(),
      pendingHomework: _mapList(
        json['pendingHomework'],
      ).map(HomeworkTask.fromJson).toList(),
      schedule: parsedSchedule,
      timeSlots: parsedTimeSlots,
      notices: _mapList(json['notices']).map(NoticeSummary.fromJson).toList(),
      unreadCount: json['unreadCount'] == null
          ? null
          : UnreadSummary.fromJson(_mapValue(json['unreadCount'])),
      gpa: json['gpa'] == null
          ? null
          : GpaSummary.fromJson(_mapValue(json['gpa'])),
    );
  }

  final SessionSummary session;
  final List<TermSummary> terms;
  final List<CourseSummary> courses;
  final List<HomeworkTask> homework;
  final List<HomeworkTask> pendingHomework;
  final Map<int, Map<int, ScheduleSlot>> schedule;
  final Map<int, String> timeSlots;
  final List<NoticeSummary> notices;
  final UnreadSummary? unreadCount;
  final GpaSummary? gpa;
}

class SessionSummary {
  SessionSummary({
    required this.ready,
    required this.baseUrl,
    required this.sessionFile,
    required this.currentTermId,
    required this.availableTerms,
    required this.availableSubjects,
    this.capturedAt,
    this.loginSource,
    this.user,
    this.currentClass,
    this.currentSubject,
  });

  factory SessionSummary.fromJson(JsonMap json) {
    return SessionSummary(
      ready: _boolValue(json['ready']),
      baseUrl: _stringValue(json['baseUrl']),
      sessionFile: _stringValue(json['sessionFile']),
      capturedAt: json['capturedAt'] == null
          ? null
          : _stringValue(json['capturedAt']),
      loginSource: json['loginSource'] == null
          ? null
          : _stringValue(json['loginSource']),
      currentTermId: _stringValue(json['currentTermId']),
      availableTerms: _mapList(
        json['availableTerms'],
      ).map(TermSummary.fromJson).toList(),
      availableSubjects: _mapList(
        json['availableSubjects'],
      ).map(SubjectSummary.fromJson).toList(),
      user: json['user'] == null
          ? null
          : UserSummary.fromJson(_mapValue(json['user'])),
      currentClass: json['currentClass'] == null
          ? null
          : ClassSummary.fromJson(_mapValue(json['currentClass'])),
      currentSubject: json['currentSubject'] == null
          ? null
          : SubjectSummary.fromJson(_mapValue(json['currentSubject'])),
    );
  }

  final bool ready;
  final String baseUrl;
  final String sessionFile;
  final String? capturedAt;
  final String? loginSource;
  final String currentTermId;
  final List<TermSummary> availableTerms;
  final List<SubjectSummary> availableSubjects;
  final UserSummary? user;
  final ClassSummary? currentClass;
  final SubjectSummary? currentSubject;
}

class UserSummary {
  UserSummary({required this.id, required this.name, required this.loginName});

  factory UserSummary.fromJson(JsonMap json) {
    return UserSummary(
      id: _stringValue(json['id']),
      name: _stringValue(json['name']),
      loginName: _stringValue(json['loginName']),
    );
  }

  final String id;
  final String name;
  final String loginName;
}

class ClassSummary {
  ClassSummary({
    required this.id,
    required this.name,
    required this.alias,
    required this.campusId,
  });

  factory ClassSummary.fromJson(JsonMap json) {
    return ClassSummary(
      id: _stringValue(json['id']),
      name: _stringValue(json['name']),
      alias: _stringValue(json['alias']),
      campusId: _stringValue(json['campusId']),
    );
  }

  final String id;
  final String name;
  final String alias;
  final String campusId;
}

class SubjectSummary {
  SubjectSummary({
    required this.id,
    required this.classId,
    required this.name,
    required this.unSubmitCount,
    this.color,
  });

  factory SubjectSummary.fromJson(JsonMap json) {
    return SubjectSummary(
      id: _stringValue(json['id']),
      classId: _stringValue(json['classId']),
      name: _stringValue(json['name']),
      unSubmitCount: _intValue(json['unSubmitCount']) ?? 0,
      color: json['color'] == null ? null : _stringValue(json['color']),
    );
  }

  final String id;
  final String classId;
  final String name;
  final int unSubmitCount;
  final String? color;
}

class TermSummary {
  TermSummary({required this.id, required this.name, required this.status});

  factory TermSummary.fromJson(JsonMap json) {
    return TermSummary(
      id: _stringValue(json['id']),
      name: _stringValue(json['name']),
      status: _boolValue(json['status']),
    );
  }

  final String id;
  final String name;
  final bool status;
}

class CourseSummary {
  CourseSummary({
    required this.id,
    required this.classId,
    required this.name,
    required this.unSubmitCount,
    this.color,
    this.teacherList = const <JsonMap>[],
  });

  factory CourseSummary.fromJson(JsonMap json) {
    return CourseSummary(
      id: _stringValue(json['id']),
      classId: _stringValue(json['classId']),
      name: _stringValue(json['name']),
      unSubmitCount: _intValue(json['unSubmitCount']) ?? 0,
      color: json['color'] == null ? null : _stringValue(json['color']),
      teacherList: _mapList(json['teacherList']),
    );
  }

  final String id;
  final String classId;
  final String name;
  final int unSubmitCount;
  final String? color;
  final List<JsonMap> teacherList;
}

class HomeworkTask {
  HomeworkTask({
    required this.id,
    required this.courseId,
    required this.courseName,
    required this.activityName,
    required this.endTime,
    required this.releaseTime,
    required this.scoreLevel,
    required this.scoreTypeName,
    required this.scoreTypeColor,
    required this.academicScore,
    required this.createName,
    required this.classId,
    required this.isParticipate,
    required this.isEnd,
    required this.raw,
  });

  factory HomeworkTask.fromJson(JsonMap json) {
    return HomeworkTask(
      id: _stringValue(json['id']),
      courseId: _stringValue(json['courseId']),
      courseName: _stringValue(json['courseName']),
      activityName: _stringValue(json['activityName']),
      endTime: _stringValue(json['endTime']),
      releaseTime: _stringValue(json['releaseTime']),
      scoreLevel: _stringValue(json['scoreLevel']),
      scoreTypeName: _stringValue(json['scoreTypeName']),
      scoreTypeColor: _stringValue(json['scoreTypeColor']),
      academicScore: _intValue(json['academicScore']),
      createName: _stringValue(json['createName']),
      classId: _stringValue(json['classId']),
      isParticipate: _intValue(json['isParticipate']),
      isEnd: _boolValue(json['isEnd']),
      raw: json,
    );
  }

  final String id;
  final String courseId;
  final String courseName;
  final String activityName;
  final String endTime;
  final String releaseTime;
  final String scoreLevel;
  final String scoreTypeName;
  final String scoreTypeColor;
  final int? academicScore;
  final String createName;
  final String classId;
  final int? isParticipate;
  final bool isEnd;
  final JsonMap raw;
}

class NoticeSummary {
  NoticeSummary({
    required this.id,
    required this.title,
    required this.content,
    required this.sender,
    required this.time,
    required this.read,
  });

  factory NoticeSummary.fromJson(JsonMap json) {
    return NoticeSummary(
      id: _stringValue(json['id']),
      title: _stringValue(json['title']),
      content: _stringValue(json['content']),
      sender: _stringValue(json['sender']),
      time: _stringValue(json['time']),
      read: _boolValue(json['read']),
    );
  }

  final String id;
  final String title;
  final String content;
  final String sender;
  final String time;
  final bool read;
}

class UnreadSummary {
  UnreadSummary({required this.noticeNotReceipt});

  factory UnreadSummary.fromJson(JsonMap json) {
    return UnreadSummary(
      noticeNotReceipt: _intValue(json['noticeNotReceipt']) ?? 0,
    );
  }

  final int noticeNotReceipt;
}

class GpaSummary {
  GpaSummary({
    this.averageLevel,
    this.achievementCount,
    this.scoreLevelCount,
    this.selectedTransferClass,
  });

  factory GpaSummary.fromJson(JsonMap json) {
    return GpaSummary(
      averageLevel: json['averageLevel'] == null
          ? null
          : _stringValue(json['averageLevel']),
      achievementCount: _intValue(json['achievementCount']),
      scoreLevelCount: _intValue(json['scoreLevelCount']),
      selectedTransferClass: json['selectedTransferClass'] == null
          ? null
          : TransferClassSummary.fromJson(
              _mapValue(json['selectedTransferClass']),
            ),
    );
  }

  final String? averageLevel;
  final int? achievementCount;
  final int? scoreLevelCount;
  final TransferClassSummary? selectedTransferClass;
}

class TransferClassSummary {
  TransferClassSummary({required this.className, this.srcClassName});

  factory TransferClassSummary.fromJson(JsonMap json) {
    return TransferClassSummary(
      className: _stringValue(json['className']),
      srcClassName: json['srcClassName'] == null
          ? null
          : _stringValue(json['srcClassName']),
    );
  }

  final String className;
  final String? srcClassName;
}

class ScheduleSlot {
  ScheduleSlot({required this.time, required this.courses});

  factory ScheduleSlot.fromJson(JsonMap json) {
    return ScheduleSlot(
      time: _stringValue(json['time']),
      courses: _mapList(json['courses']).map(ScheduleCourse.fromJson).toList(),
    );
  }

  final String time;
  final List<ScheduleCourse> courses;
}

class ScheduleCourse {
  ScheduleCourse({
    required this.name,
    required this.teacher,
    required this.room,
    required this.color,
  });

  factory ScheduleCourse.fromJson(JsonMap json) {
    return ScheduleCourse(
      name: _stringValue(json['name']),
      teacher: _stringValue(json['teacher']),
      room: _stringValue(json['room']),
      color: _stringValue(json['color']),
    );
  }

  final String name;
  final String teacher;
  final String room;
  final String color;
}

class TaskDetail {
  TaskDetail({
    required this.taskId,
    required this.contentText,
    required this.answerText,
    required this.attachments,
    required this.mySubmissionAttachments,
    required this.otherSubmissionCount,
    required this.rawTask,
    this.taskSummary,
    this.lastScore,
    this.highScoreSubmissions = const <HighScoreSubmission>[],
  });

  factory TaskDetail.fromJson(JsonMap json) {
    return TaskDetail(
      taskId: _stringValue(json['taskId']),
      contentText: _stringValue(json['contentText']),
      answerText: _stringValue(json['answerText']),
      attachments: _mapList(
        json['attachments'],
      ).map(AttachmentInfo.fromJson).toList(),
      mySubmissionAttachments: _mapList(
        json['mySubmissionAttachments'],
      ).map(AttachmentInfo.fromJson).toList(),
      otherSubmissionCount: _intValue(json['otherSubmissionCount']) ?? 0,
      rawTask: _mapValue(json['task']),
      taskSummary: json['taskSummary'] == null
          ? null
          : HomeworkTask.fromJson(_mapValue(json['taskSummary'])),
      lastScore: json['lastScore'] == null
          ? null
          : _mapValue(json['lastScore']),
      highScoreSubmissions: _mapList(json['highScoreSubmissions'])
          .map(HighScoreSubmission.fromJson)
          .toList(),
    );
  }

  final String taskId;
  final HomeworkTask? taskSummary;
  final String contentText;
  final String answerText;
  final List<AttachmentInfo> attachments;
  final List<AttachmentInfo> mySubmissionAttachments;
  final int otherSubmissionCount;
  final JsonMap rawTask;
  final JsonMap? lastScore;
  final List<HighScoreSubmission> highScoreSubmissions;
}

class AttachmentInfo {
  AttachmentInfo({
    required this.fileId,
    required this.fileName,
    required this.name,
    required this.fileExt,
    required this.source,
  });

  factory AttachmentInfo.fromJson(JsonMap json) {
    return AttachmentInfo(
      fileId: _stringValue(json['fileId']),
      fileName: _stringValue(json['fileName']),
      name: _stringValue(json['name']),
      fileExt: _stringValue(json['fileExt']),
      source: _stringValue(json['source']),
    );
  }

  final String fileId;
  final String fileName;
  final String name;
  final String fileExt;
  final String source;
}

class HighScoreSubmission {
  HighScoreSubmission({
    required this.score,
    required this.receiptTime,
    this.academicScore,
    this.level,
    this.userName,
    this.remark,
    this.fileList,
  });

  factory HighScoreSubmission.fromJson(JsonMap json) {
    final rawFileList = json['fileList'];
    final List<JsonMap>? fileList = rawFileList is List
        ? rawFileList.map((item) => _mapValue(item)).toList()
        : null;

    return HighScoreSubmission(
      score: _intValue(json['score']) ?? 0,
      academicScore: _intValue(json['academicScore']),
      level: json['level'] == null ? null : _stringValue(json['level']),
      receiptTime: _stringValue(json['receiptTime']),
      userName: json['userName'] == null ? null : _stringValue(json['userName']),
      remark: json['remark'] == null ? null : _stringValue(json['remark']),
      fileList: fileList,
    );
  }

  final int score;
  final int? academicScore;
  final String? level;
  final String receiptTime;
  final String? userName;
  final String? remark;
  final List<JsonMap>? fileList;
}

class AttachmentDownload {
  AttachmentDownload({
    required this.path,
    required this.uri,
    required this.fileName,
  });

  factory AttachmentDownload.fromJson(JsonMap json) {
    return AttachmentDownload(
      path: _stringValue(json['path']),
      uri: _stringValue(json['uri']),
      fileName: _stringValue(json['fileName']),
    );
  }

  final String path;
  final String uri;
  final String fileName;
}

class PrivateContact {
  PrivateContact({
    required this.id,
    required this.classId,
    required this.className,
    required this.peerId,
    required this.peerName,
    required this.peerType,
    required this.unreadNum,
    required this.lastTime,
    required this.lastContent,
    this.peerAvatar,
    this.peerSexCode,
    this.courseName,
    this.courseColor,
    this.raw,
  });

  factory PrivateContact.fromJson(JsonMap json) {
    return PrivateContact(
      id: _stringValue(json['id']),
      classId: _stringValue(json['classId']),
      className: _stringValue(json['className']),
      peerId: _stringValue(json['peerId']),
      peerName: _stringValue(json['peerName']),
      peerType: _stringValue(json['peerType']),
      unreadNum: _intValue(json['unreadNum']) ?? 0,
      lastTime: _stringValue(json['lastTime']),
      lastContent: _stringValue(json['lastContent']),
      peerAvatar: json['peerAvatar'] == null ? null : _stringValue(json['peerAvatar']),
      peerSexCode: _intValue(json['peerSexCode']),
      courseName: json['courseName'] == null ? null : _stringValue(json['courseName']),
      courseColor: json['courseColor'] == null ? null : _stringValue(json['courseColor']),
      raw: json,
    );
  }

  final String id;
  final String classId;
  final String className;
  final String peerId;
  final String peerName;
  final String peerType;
  final int unreadNum;
  final String lastTime;
  final String lastContent;
  final String? peerAvatar;
  final int? peerSexCode;
  final String? courseName;
  final String? courseColor;
  final JsonMap? raw;
}

class PrivateMessage {
  PrivateMessage({
    required this.id,
    required this.content,
    required this.senderId,
    required this.senderName,
    required this.receiverId,
    required this.receiverName,
    required this.createTime,
    this.contentType,
    this.readFlag,
    this.senderType,
    this.receiverType,
  });

  factory PrivateMessage.fromJson(JsonMap json) {
    return PrivateMessage(
      id: _stringValue(json['id']),
      content: _stringValue(json['content']),
      senderId: _stringValue(json['senderId']),
      senderName: _stringValue(json['senderName']),
      receiverId: _stringValue(json['receiverId']),
      receiverName: _stringValue(json['receiverName']),
      createTime: _stringValue(json['createTime']),
      contentType: json['contentType'] == null ? null : _stringValue(json['contentType']),
      readFlag: _intValue(json['readFlag']),
      senderType: json['senderType'] == null ? null : _stringValue(json['senderType']),
      receiverType: json['receiverType'] == null ? null : _stringValue(json['receiverType']),
    );
  }

  final String id;
  final String content;
  final String senderId;
  final String senderName;
  final String receiverId;
  final String receiverName;
  final String createTime;
  final String? contentType;
  final int? readFlag;
  final String? senderType;
  final String? receiverType;
}

String prettyJson(JsonMap value) {
  const encoder = JsonEncoder.withIndent('  ');
  return encoder.convert(value);
}
