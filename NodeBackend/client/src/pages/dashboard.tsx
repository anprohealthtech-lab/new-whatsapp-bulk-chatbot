import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { useSocket } from "@/hooks/useSocket";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  MessageSquare, 
  FileUp, 
  History, 
  Settings, 
  Gauge, 
  Send, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  RefreshCw,
  Bell,
  User,
  Phone,
  Calendar,
  Filter,
  Search,
  Eye,
  RotateCcw,
  QrCode,
  Wifi,
  WifiOff
} from "lucide-react";

// Form schemas
const messageSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required"),
  content: z.string().min(1, "Message content is required"),
});

const reportSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required"),
  sampleId: z.string().min(1, "Sample ID is required"),
  content: z.string().optional(),
  file: z.instanceof(File).refine((file) => file.size > 0, "File is required"),
});

type MessageFormData = z.infer<typeof messageSchema>;
type ReportFormData = z.infer<typeof reportSchema>;

export default function Dashboard() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [messageFilters, setMessageFilters] = useState({
    status: "all",
    search: "",
    limit: 10,
    offset: 0,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isConnected, whatsappStatus, qrCode } = useSocket();

  // Auto-show QR modal when WhatsApp is not connected 
  useEffect(() => {
    if (!whatsappStatus.isConnected && !whatsappStatus.isAuthenticated) {
      setShowQRModal(true);
      console.log('🎯 WhatsApp not connected - showing QR modal to initiate connection');
    }
  }, [whatsappStatus.isConnected, whatsappStatus.isAuthenticated]);

  // Auto-hide QR modal when WhatsApp connects
  useEffect(() => {
    if (whatsappStatus.isConnected) {
      setShowQRModal(false);
      console.log('🎯 WhatsApp connected, hiding QR modal');
    }
  }, [whatsappStatus.isConnected]);

  // Form setup
  const messageForm = useForm<MessageFormData>({
    resolver: zodResolver(messageSchema),
    defaultValues: {
      phoneNumber: "",
      content: "",
    },
  });

  const reportForm = useForm<ReportFormData>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      phoneNumber: "",
      sampleId: "",
      content: "",
    },
  });

  // Queries
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["/api/status"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: messageHistory, isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/messages", messageFilters],
    queryFn: () => api.getMessages(messageFilters),
  });

  // Mutations
  const sendMessageMutation = useMutation({
    mutationFn: ({ phoneNumber, content }: MessageFormData) => 
      api.sendMessage(phoneNumber, content),
    onSuccess: () => {
      messageForm.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
      toast({
        title: "Message Sent",
        description: "Your message has been sent successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      });
    },
  });

  const sendReportMutation = useMutation({
    mutationFn: ({ phoneNumber, sampleId, content, file }: ReportFormData) => 
      api.sendReport(phoneNumber, sampleId, file, content),
    onSuccess: () => {
      reportForm.reset();
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
      toast({
        title: "Report Sent",
        description: "Your report has been sent successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send report",
        variant: "destructive",
      });
    },
  });

  const generateQRMutation = useMutation({
    mutationFn: api.generateQR,
    onSuccess: () => {
      setShowQRModal(true);
      toast({
        title: "QR Code Generated",
        description: "Scan the QR code with WhatsApp to connect",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate QR code",
        variant: "destructive",
      });
    },
  });

  const resendMessageMutation = useMutation({
    mutationFn: (messageId: string) => api.resendMessage(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({
        title: "Message Resent",
        description: "The message has been resent successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to resend message",
        variant: "destructive",
      });
    },
  });

  // Handlers
  const handleSendMessage = (data: MessageFormData) => {
    sendMessageMutation.mutate(data);
  };

  const handleSendReport = (data: ReportFormData) => {
    if (!selectedFile) {
      toast({
        title: "Error",
        description: "Please select a file to upload",
        variant: "destructive",
      });
      return;
    }

    sendReportMutation.mutate({
      ...data,
      file: selectedFile,
    });
  };

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type and size
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
      const maxSize = 10 * 1024 * 1024; // 10MB

      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Invalid File Type",
          description: "Please select a PDF, JPG, or PNG file",
          variant: "destructive",
        });
        return;
      }

      if (file.size > maxSize) {
        toast({
          title: "File Too Large",
          description: "File size must be less than 10MB",
          variant: "destructive",
        });
        return;
      }

      setSelectedFile(file);
      reportForm.setValue("file", file);
    }
  }, [reportForm, toast]);

  const handleFileDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      const input = document.createElement('input');
      input.type = 'file';
      input.files = event.dataTransfer.files;
      const fakeEvent = { target: input } as React.ChangeEvent<HTMLInputElement>;
      handleFileSelect(fakeEvent);
    }
  }, [handleFileSelect]);

  const handleFilterChange = (key: string, value: string) => {
    setMessageFilters(prev => ({
      ...prev,
      [key]: value,
      offset: 0, // Reset to first page when filtering
    }));
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Delivered</Badge>;
      case 'sent':
        return <Badge className="bg-blue-100 text-blue-800"><Send className="w-3 h-3 mr-1" />Sent</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800"><AlertTriangle className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'report':
        return <FileText className="w-4 h-4" />;
      case 'text':
        return <MessageSquare className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white shadow-lg border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <MessageSquare className="text-white text-xl" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">LIMS Integration</h1>
              <p className="text-sm text-gray-500">WhatsApp System</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          <a href="#" className="flex items-center px-4 py-3 text-primary bg-blue-50 border-r-2 border-primary rounded-lg font-medium">
            <Gauge className="w-5 mr-3" />
            Single User Dashboard
          </a>
          <a href="/multi" className="flex items-center px-4 py-3 text-gray-600 hover:text-primary hover:bg-gray-50 rounded-lg font-medium">
            <User className="w-5 mr-3" />
            Multi-User Dashboard
          </a>
          <a href="#" className="flex items-center px-4 py-3 text-gray-600 hover:text-primary hover:bg-gray-50 rounded-lg transition-colors">
            <MessageSquare className="w-5 mr-3" />
            Messages
          </a>
          <a href="#" className="flex items-center px-4 py-3 text-gray-600 hover:text-primary hover:bg-gray-50 rounded-lg transition-colors">
            <FileUp className="w-5 mr-3" />
            Send Reports
          </a>
          <a href="#" className="flex items-center px-4 py-3 text-gray-600 hover:text-primary hover:bg-gray-50 rounded-lg transition-colors">
            <History className="w-5 mr-3" />
            Message History
          </a>
          <a href="#" className="flex items-center px-4 py-3 text-gray-600 hover:text-primary hover:bg-gray-50 rounded-lg transition-colors">
            <Settings className="w-5 mr-3" />
            Settings
          </a>
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
              <User className="text-gray-600 text-sm" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Lab Admin</p>
              <p className="text-xs text-gray-500">System Administrator</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
              <p className="text-gray-600">WhatsApp LIMS Integration System</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                {isConnected ? (
                  <Wifi className="w-4 h-4 text-green-500" />
                ) : (
                  <WifiOff className="w-4 h-4 text-red-500" />
                )}
                <span className="text-sm text-gray-600">
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => queryClient.invalidateQueries()}
                disabled={statusLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${statusLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">WhatsApp Status</p>
                    <p className="text-2xl font-bold text-green-600">
                      {whatsappStatus.isConnected ? 'Connected' : 'Disconnected'}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <MessageSquare className="text-green-600 text-2xl" />
                  </div>
                </div>
                <div className="mt-4 flex items-center">
                  <div className={`w-2 h-2 rounded-full mr-2 ${whatsappStatus.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-xs text-gray-500">
                    {whatsappStatus.lastSeen ? `Last seen: ${formatTimestamp(whatsappStatus.lastSeen)}` : 'Never connected'}
                  </span>
                </div>
                {!whatsappStatus.isConnected && (
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => generateQRMutation.mutate()}
                    disabled={generateQRMutation.isPending}
                  >
                    <QrCode className="w-4 h-4 mr-2" />
                    Connect WhatsApp
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Messages Today</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {status?.stats?.sentToday || 0}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Send className="text-blue-600 text-xl" />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-xs text-green-600">
                    +{status?.stats?.deliveredToday || 0} delivered
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Messages</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {status?.stats?.totalMessages || 0}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <FileText className="text-green-600 text-xl" />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-xs text-gray-500">
                    {status?.stats?.pendingCount || 0} pending
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Failed Messages</p>
                    <p className="text-2xl font-bold text-red-600">
                      {status?.stats?.failedToday || 0}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                    <AlertTriangle className="text-red-600 text-xl" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Send Message Panel */}
            <div className="lg:col-span-1 space-y-6">
              <Card>
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Send Message</h3>
                  
                  <Form {...messageForm}>
                    <form onSubmit={messageForm.handleSubmit(handleSendMessage)} className="space-y-4">
                      <FormField
                        control={messageForm.control}
                        name="phoneNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input placeholder="+1234567890" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={messageForm.control}
                        name="content"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Message</FormLabel>
                            <FormControl>
                              <Textarea 
                                rows={3}
                                placeholder="Type your message here..."
                                className="resize-none"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <Button 
                        type="submit" 
                        className="w-full bg-green-600 hover:bg-green-700"
                        disabled={sendMessageMutation.isPending}
                      >
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Send Message
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>

              {/* File Upload Panel */}
              <Card>
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Send Report</h3>
                  
                  <div 
                    className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-primary transition-colors cursor-pointer mb-4"
                    onDrop={handleFileDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => document.getElementById('file-input')?.click()}
                  >
                    <input
                      id="file-input"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <div className="space-y-3">
                      <div className="mx-auto w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                        <FileUp className="text-gray-400 text-xl" />
                      </div>
                      <div>
                        {selectedFile ? (
                          <p className="text-sm text-gray-900 font-medium">{selectedFile.name}</p>
                        ) : (
                          <>
                            <p className="text-sm text-gray-600">Drag and drop your report here</p>
                            <p className="text-xs text-gray-400">PDF, JPG, PNG up to 10MB</p>
                          </>
                        )}
                      </div>
                      <Button type="button" variant="outline" size="sm">
                        Browse Files
                      </Button>
                    </div>
                  </div>

                  <Form {...reportForm}>
                    <form onSubmit={reportForm.handleSubmit(handleSendReport)} className="space-y-4">
                      <FormField
                        control={reportForm.control}
                        name="phoneNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input placeholder="+1234567890" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={reportForm.control}
                        name="sampleId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Patient/Sample ID</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. SAMPLE-2024-001" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={reportForm.control}
                        name="content"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Message (Optional)</FormLabel>
                            <FormControl>
                              <Input placeholder="Custom message..." {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <Button 
                        type="submit" 
                        className="w-full"
                        disabled={sendReportMutation.isPending || !selectedFile}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Send Report
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </div>

            {/* Message History */}
            <div className="lg:col-span-2">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">Message History</h3>
                    <div className="flex items-center space-x-3">
                      <Select 
                        value={messageFilters.status} 
                        onValueChange={(value) => handleFilterChange('status', value)}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="delivered">Delivered</SelectItem>
                          <SelectItem value="sent">Sent</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                        </SelectContent>
                      </Select>
                      
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <Input
                          placeholder="Search messages..."
                          value={messageFilters.search}
                          onChange={(e) => handleFilterChange('search', e.target.value)}
                          className="pl-10 w-48"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Timestamp</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Recipient</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Type</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Content</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {messagesLoading ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-gray-500">
                              Loading messages...
                            </td>
                          </tr>
                        ) : messageHistory?.messages.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-gray-500">
                              No messages found
                            </td>
                          </tr>
                        ) : (
                          messageHistory?.messages.map((message) => (
                            <tr key={message.id} className="hover:bg-gray-50 transition-colors">
                              <td className="py-3 px-4">
                                <div className="text-gray-900 font-mono text-xs">
                                  {formatTimestamp(message.createdAt)}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="text-gray-900">{message.phoneNumber}</div>
                                {message.sampleId && (
                                  <div className="text-xs text-gray-500">{message.sampleId}</div>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center space-x-2">
                                  {getTypeIcon(message.type)}
                                  <span className="capitalize">{message.type}</span>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="text-gray-900 truncate max-w-xs">
                                  {message.content}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                {getStatusBadge(message.status)}
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center space-x-2">
                                  <Button variant="ghost" size="sm">
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                  {message.status === 'failed' && (
                                    <Button 
                                      variant="ghost" 
                                      size="sm"
                                      onClick={() => resendMessageMutation.mutate(message.id)}
                                      disabled={resendMessageMutation.isPending}
                                    >
                                      <RotateCcw className="w-4 h-4" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  
                  {messageHistory && messageHistory.messages.length > 0 && (
                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
                      <div className="text-sm text-gray-700">
                        Showing {messageHistory.messages.length} of {messageHistory.total} results
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={messageFilters.offset === 0}
                          onClick={() => handleFilterChange('offset', Math.max(0, messageFilters.offset - messageFilters.limit).toString())}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={messageFilters.offset + messageFilters.limit >= messageHistory.total}
                          onClick={() => handleFilterChange('offset', (messageFilters.offset + messageFilters.limit).toString())}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>

      {/* QR Code Modal */}
      <Dialog open={showQRModal} onOpenChange={setShowQRModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect WhatsApp</DialogTitle>
          </DialogHeader>
          
          <div className="text-center">
            <div className="w-64 h-64 bg-gray-100 dark:bg-gray-800 rounded-lg mx-auto mb-4 flex items-center justify-center">
              {qrCode ? (
                <div className="text-center">
                  <img 
                    src={qrCode} 
                    alt="WhatsApp QR Code" 
                    className="w-full h-full object-contain rounded-lg"
                    onError={(e) => {
                      console.error('QR Code image failed to load:', qrCode);
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                    onLoad={() => {
                      console.log('QR Code image loaded successfully');
                    }}
                  />
                </div>
              ) : (
                <div className="text-center">
                  <QrCode className="w-16 h-16 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Generating WhatsApp QR code...</p>
                  <p className="text-xs text-gray-400 mt-1">This may take a few seconds</p>
                </div>
              )}
            </div>
            
            <div className="space-y-2 text-sm text-gray-600 mb-6">
              <p><strong>📱 To connect your WhatsApp:</strong></p>
              <p>1. Open <strong>WhatsApp</strong> on your phone</p>
              <p>2. Go to <strong>Settings</strong> → <strong>Linked Devices</strong></p>
              <p>3. Tap <strong>"Link a Device"</strong></p>
              <p>4. Scan the QR code above with your phone camera</p>
              <p className="text-green-600 font-medium">✅ This is a REAL WhatsApp QR code!</p>
            </div>
            
            <div className="flex space-x-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => generateQRMutation.mutate()}
                disabled={generateQRMutation.isPending}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh QR
              </Button>
              <Button
                className="flex-1"
                onClick={() => setShowQRModal(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
