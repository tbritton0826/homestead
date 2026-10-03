import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
export default function CalendarView(props) {
  return <FullCalendar {...props} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, multiMonthPlugin]} />;
}
