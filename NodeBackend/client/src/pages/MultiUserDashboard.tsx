import React, { useState, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';

interface User {
  id: string;
  username: string;
  email?: string;
  role: string;
  organizationId?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

interface Session {
  id: string;
  userId: string;
  phoneNumber?: string;
  isAuthenticated: boolean;
  isActive: boolean;
  lastActivity: string;
  connectionAttempts: number;
  strategy: string;
}

interface SystemStatus {
  totalSessions: number;
  activeSessions: number;
  authenticatedSessions: number;
  sessionsPerUser: Record<string, number>;
  uptime: number;
}

interface QRCodeData {
  sessionId: string;
  userId: string;
  qr: string;
}

export function MultiUserDashboard() {
  const [users, setUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [currentQR, setCurrentQR] = useState<QRCodeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('users');
  
  const { isConnected, whatsappStatus } = useSocket();

  // Get auth token from localStorage
  const getAuthToken = () => {
    return localStorage.getItem('auth_token');
  };

  // API call helper with auth
  const apiCall = async (endpoint: string, options: RequestInit = {}) => {
    const token = getAuthToken();
    const response = await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    return response.json();
  };

  // Load system data
  const loadSystemData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [usersResponse, statusResponse] = await Promise.all([
        apiCall('/admin/users'),
        apiCall('/admin/status'),
      ]);

      setUsers(usersResponse.data.users);
      setSystemStatus(statusResponse.data.system);
      setSessions(statusResponse.data.sessions);
    } catch (err: any) {
      setError(err.message);
      console.error('Failed to load system data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Create new session for user
  const createUserSession = async (userId: string, strategy: string = 'business_hours') => {
    try {
      const response = await apiCall('/sessions/create', {
        method: 'POST',
        body: JSON.stringify({ strategyName: strategy }),
      });

      if (response.success) {
        loadSystemData(); // Refresh data
        if (response.data.qrCode) {
          setCurrentQR({
            sessionId: response.data.sessionId,
            userId,
            qr: response.data.qrCode,
          });
        }
      }
    } catch (err: any) {
      setError(`Failed to create session: ${err.message}`);
    }
  };

  // Disconnect user sessions
  const disconnectUserSessions = async (userId: string) => {
    try {
      await apiCall(`/admin/users/${userId}/sessions`, {
        method: 'DELETE',
      });
      loadSystemData(); // Refresh data
    } catch (err: any) {
      setError(`Failed to disconnect sessions: ${err.message}`);
    }
  };

  // Load data on mount
  useEffect(() => {
    loadSystemData();
  }, []);

  // Format uptime
  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  // Get session status
  const getSessionStatus = (session: Session) => {
    if (session.isAuthenticated && session.isActive) {
      return { status: 'Connected', color: 'text-green-600' };
    } else if (session.isActive) {
      return { status: 'Connecting', color: 'text-yellow-600' };
    } else {
      return { status: 'Disconnected', color: 'text-red-600' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-2 text-gray-600">Loading system data...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Multi-User WhatsApp LIMS</h1>
          <p className="text-gray-500">
            Manage multiple WhatsApp connections and users
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span className={`px-2 py-1 text-sm rounded-full ${isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {isConnected ? 'Socket Connected' : 'Socket Disconnected'}
          </span>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <div className="mt-2 text-sm text-red-700">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* System Overview Cards */}
      {systemStatus && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 text-sm font-medium">T</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Sessions</dt>
                    <dd className="text-lg font-medium text-gray-900">{systemStatus.totalSessions}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                    <span className="text-green-600 text-sm font-medium">A</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Active Sessions</dt>
                    <dd className="text-lg font-medium text-green-600">{systemStatus.activeSessions}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 text-sm font-medium">C</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Authenticated</dt>
                    <dd className="text-lg font-medium text-blue-600">{systemStatus.authenticatedSessions}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                    <span className="text-gray-600 text-sm font-medium">U</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">System Uptime</dt>
                    <dd className="text-lg font-medium text-gray-900">{formatUptime(systemStatus.uptime)}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {currentQR && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-blue-900">
              WhatsApp QR Code - Session {currentQR.sessionId.slice(-8)}
            </h3>
            <button 
              onClick={() => setCurrentQR(null)}
              className="text-blue-600 hover:text-blue-800"
            >
              ✕
            </button>
          </div>
          <p className="text-blue-700 mb-4">
            Scan this QR code with WhatsApp to authenticate the session
          </p>
          <div className="flex justify-center">
            <img src={currentQR.qr} alt="WhatsApp QR Code" className="w-64 h-64" />
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('users')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'users'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Users
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'sessions'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Sessions
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'settings'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Settings
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'users' && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">User Management</h3>
            <p className="text-sm text-gray-500 mb-6">Manage users and their WhatsApp sessions</p>
            
            <div className="space-y-4">
              {users.map((user) => {
                const userSessions = sessions.filter(s => s.userId === user.id);
                const activeSessions = userSessions.filter(s => s.isActive);
                
                return (
                  <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{user.username}</span>
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          user.isActive ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {user.role}
                        </span>
                        {user.email && (
                          <span className="text-sm text-gray-500">{user.email}</span>
                        )}
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-gray-500">
                        <span>Sessions: {userSessions.length}</span>
                        <span>Active: {activeSessions.length}</span>
                        {user.lastLoginAt && (
                          <span>Last login: {new Date(user.lastLoginAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => createUserSession(user.id)}
                        disabled={activeSessions.length > 0}
                        className={`px-3 py-1 text-sm rounded ${
                          activeSessions.length > 0
                            ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                            : 'bg-blue-500 text-white hover:bg-blue-600'
                        }`}
                      >
                        Connect WhatsApp
                      </button>
                      
                      {activeSessions.length > 0 && (
                        <button
                          onClick={() => disconnectUserSessions(user.id)}
                          className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sessions' && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Active Sessions</h3>
            <p className="text-sm text-gray-500 mb-6">Monitor all WhatsApp sessions across users</p>
            
            <div className="space-y-4">
              {sessions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No active sessions found
                </div>
              ) : (
                sessions.map((session) => {
                  const user = users.find(u => u.id === session.userId);
                  const { status, color } = getSessionStatus(session);
                  
                  return (
                    <div key={session.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">
                            {user?.username || 'Unknown User'}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded-full ${color} bg-opacity-10`}>
                            {status}
                          </span>
                          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded-full">
                            {session.strategy}
                          </span>
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span>ID: {session.id.slice(-8)}</span>
                          {session.phoneNumber && (
                            <span>Phone: {session.phoneNumber}</span>
                          )}
                          <span>
                            Last Activity: {new Date(session.lastActivity).toLocaleString()}
                          </span>
                          <span>Attempts: {session.connectionAttempts}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <button className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                          Monitor
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">System Settings</h3>
            <p className="text-sm text-gray-500 mb-6">Configure system-wide settings and limits</p>
            
            <div className="space-y-6">
              <div>
                <h4 className="font-medium mb-2">Session Strategies</h4>
                <div className="grid gap-3">
                  <div className="p-3 border rounded">
                    <div className="font-medium">Business Hours</div>
                    <div className="text-sm text-gray-600">12-hour sessions, auto-reconnect during business hours</div>
                  </div>
                  <div className="p-3 border rounded">
                    <div className="font-medium">Always On</div>
                    <div className="text-sm text-gray-600">24-hour sessions, continuous operation</div>
                  </div>
                  <div className="p-3 border rounded">
                    <div className="font-medium">On Demand</div>
                    <div className="text-sm text-gray-600">4-hour sessions, manual reconnection required</div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">Rate Limits</h4>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span>Messages per minute:</span>
                    <span>20</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Messages per hour:</span>
                    <span>1,000</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Messages per day:</span>
                    <span>5,000</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Media files per hour:</span>
                    <span>100</span>
                  </div>
                </div>
              </div>

              <div>
                <button 
                  onClick={loadSystemData}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Refresh System Data
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}